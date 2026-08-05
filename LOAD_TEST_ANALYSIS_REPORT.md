# 📊 Load Testing Analysis & Server Performance Optimization Report

**Target Endpoint:** `/api/auth/signin`  
**Test Configuration:** Moderate Load (~100 concurrent VUs | 3 VUs/sec for 200 sec | 600 total requests)  
**Date:** August 5, 2026  

---

## 1. Executive Summary

During the moderate sustained load test (3 virtual users/second over 200 seconds), **600 total requests** were sent to the authentication endpoint `/api/auth/signin`.

- **Successful Requests (200 OK):** 100 requests (16.7%)
- **Blocked Requests (429 Too Many Requests):** 500 requests (83.3%)
- **Server Errors (500 Internal Error):** 0 requests (0%)
- **Mean Response Time:** 77 ms
- **P95 Latency:** 498 ms

### 🔍 Primary Finding
The test did **NOT** fail due to server crashes, memory leaks, database timeouts, or CPU bottlenecks.  
Instead, the test hit an intentionally configured rate-limiting safeguard in [RateLimitMiddleware.js](file:///e:/GradeMeAI/AssessQ/server/middlewares/RateLimitMiddleware.js#L15-L23): **`authLimiter` caps requests to 100 login attempts per 15-minute window per IP address**.

Because all 600 requests in the Artillery test originated from a single client machine (`127.0.0.1`), the first 100 requests succeeded instantly (200 OK), and the remaining 500 requests were correctly rejected with HTTP `429 Too Many Requests` (`{"status":429,"message":"Too many attempts. Try again later."}`).

---

## 2. Detailed Performance & Metric Breakdown

| Metric | Measured Value | Analysis & Impact |
| :--- | :--- | :--- |
| **Success Rate** | **16.7%** | Low due to strict rate limit threshold (100 requests limit reached after ~33 seconds). |
| **HTTP 200 OK** | **100** | First 100 requests succeeded seamlessly. |
| **HTTP 429 Too Many Requests** | **500** | Rate limiter triggered as intended to block brute-force / spam attacks. |
| **HTTP 500 Errors** | **0** | Server remained 100% stable without process crashes or uncaught exceptions. |
| **Mean Latency** | **77 ms** | Extremely fast execution for valid and rate-limited responses. |
| **P95 Latency** | **498 ms** | Acceptable P95 response time under concurrent pressure. |

---

## 3. Technical Root Cause

In `AssessQ/server`:

1. **[RateLimitMiddleware.js](file:///e:/GradeMeAI/AssessQ/server/middlewares/RateLimitMiddleware.js#L15-L23):**
   ```javascript
   export const authLimiter = rateLimit({
       windowMs: 15 * 60 * 1000, // 15 minutes
       max: 100,                 // Only 100 login attempts per 15 min
       message: {
           status: 429,
           message: "Too many attempts. Try again later."
       },
       standardHeaders: true,
       legacyHeaders: false
   });
   ```

2. **[app.js](file:///e:/GradeMeAI/AssessQ/server/app.js#L66):**
   ```javascript
   app.use('/api/auth', authLimiter);
   ```

3. **Single IP Bucket issue:**
   `express-rate-limit` tracks clients using `req.ip` by default. When running Artillery locally or from a single IP, all virtual users share the exact same rate-limit bucket. Once 100 requests are sent, all subsequent virtual users are blocked until the 15-minute window resets.

---

## 4. Recommended Changes to Increase Server Capacity & Performance

To scale your server to support thousands of concurrent users and run successful heavy/stress load tests, follow these recommendations categorized by priority:

---

### Phase 1: Immediate Adjustments for Load Testing & Staging

#### 1. Configurable Rate Limits via Environment Variables
Allow disabling or dynamically adjusting rate limits during load testing while keeping protection active in production.

**Update `[RateLimitMiddleware.js](file:///e:/GradeMeAI/AssessQ/server/middlewares/RateLimitMiddleware.js)`:**
```javascript
import rateLimit from 'express-rate-limit';

const isLoadTesting = process.env.DISABLE_RATE_LIMIT === 'true';

export const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.API_RATE_LIMIT_MAX ? parseInt(process.env.API_RATE_LIMIT_MAX) : 3000,
    skip: () => isLoadTesting,
    message: { status: 429, message: "Too many requests. Please try again later." }
});

export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.AUTH_RATE_LIMIT_MAX ? parseInt(process.env.AUTH_RATE_LIMIT_MAX) : 100,
    skip: () => isLoadTesting,
    message: { status: 429, message: "Too many attempts. Try again later." }
});
```

---

### Phase 2: Application & Server Performance Tuning

#### 2. Multi-Core Scaling with PM2 Cluster Mode
Node.js is single-threaded by default. Password hashing (`bcrypt.compare`) is CPU-intensive. Running Node on a single thread limits your throughput to 1 CPU core.

Use PM2 in cluster mode to utilize all CPU cores on your server host:
```bash
# Start server in cluster mode using all CPU cores
npx pm2 start index.js -i max --name "assessq-server"
```
Or configure `[ecosystem.config.cjs](file:///e:/GradeMeAI/AssessQ/server/ecosystem.config.cjs)`:
```javascript
module.exports = {
  apps: [{
    name: "assessq-server",
    script: "./index.js",
    instances: "max",
    exec_mode: "cluster",
    env: {
      NODE_ENV: "production",
    }
  }]
}
```

#### 3. Distributed Rate Limiting using Redis (`rate-limit-redis`)
When running PM2 cluster mode or multiple container instances, in-memory rate limiting fails because each worker maintains a separate state.
Use Redis as the centralized rate-limit store:
```javascript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

export const authLimiter = rateLimit({
    store: new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
    }),
    windowMs: 15 * 60 * 1000,
    max: 100,
    skip: () => process.env.DISABLE_RATE_LIMIT === 'true'
});
```

#### 4. Optimize Database Queries & Indexing
In `[UserModel.js](file:///e:/GradeMeAI/AssessQ/server/models/UserModel.js)` & `[AuthController.js](file:///e:/GradeMeAI/AssessQ/server/controllers/AuthController.js#L226-L231)`:
- Ensure `{ email: 1 }` and `{ phoneNumber: 1 }` indexes are explicitly created in MongoDB:
  ```javascript
  userSchema.index({ email: 1 });
  userSchema.index({ phoneNumber: 1 });
  ```
- Use `.lean()` for read-only user checks during sign-in to bypass Mongoose hydration overhead:
  ```javascript
  users = await UserModel.find({ email: email }).lean();
  ```

#### 5. Tune Database Connection Pool
Increase MongoDB connection pool size in `config/db.js` / Mongoose `connect` options to handle high concurrent queries:
```javascript
await mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: 100, // Default is 10; increase for heavy concurrent loads
    minPoolSize: 10,
    socketTimeoutMS: 45000,
});
```

#### 6. Optimize Password Hashing (Bcrypt Cost Factor)
Bcrypt cost factor defaults to 10 rounds. If set higher (e.g. 12+), login throughput degrades exponentially under high concurrency. Ensure `bcrypt.genSalt(10)` is maintained or evaluate `argon2` for better multi-threading performance.

---

### Phase 3: Infrastructure & Architecture Improvements

#### 7. Reverse Proxy & Nginx / Cloudflare Offloading
- Deploy Nginx or Cloudflare in front of Node.js to handle SSL/TLS termination, HTTP/2 multiplexing, static asset caching, and network-level DDoS/Rate Limiting.
- Enables Node.js to process application logic only.

#### 8. Asynchronous Logging Stream
Heavy logging in `[AuthController.js](file:///e:/GradeMeAI/AssessQ/server/controllers/AuthController.js#L221)` (`logger.info(...)`) can cause I/O bottlenecks under high RPS. Ensure logger uses non-blocking asynchronous buffering (e.g. `pino` or `winston` async transports).

---

## 5. Summary Action Checklist

| Priority | Action Item | Target File / Area | Expected Result |
| :---: | :--- | :--- | :--- |
| 🔴 **P0** | Add `DISABLE_RATE_LIMIT` env flag to bypass rate limits during load tests | [RateLimitMiddleware.js](file:///e:/GradeMeAI/AssessQ/server/middlewares/RateLimitMiddleware.js) | Allows load test to reach 600+ RPS without 429 blocks |
| 🟠 **P1** | Run PM2 in Cluster Mode (`-i max`) | `ecosystem.config.cjs` / CLI | Multiplies throughput by total CPU core count |
| 🟠 **P1** | Verify & Ensure `{ email: 1 }` Index | [UserModel.js](file:///e:/GradeMeAI/AssessQ/server/models/UserModel.js) | Prevents full table scans during sign-in |
| 🟡 **P2** | Add `.lean()` to sign-in queries | [AuthController.js](file:///e:/GradeMeAI/AssessQ/server/controllers/AuthController.js#L227) | Reduces Node memory footprint & response latency |
| 🟡 **P2** | Increase Mongoose Connection `maxPoolSize: 100` | MongoDB Config | Prevents DB connection pool starvation |
| 🟢 **P3** | Use Redis for distributed rate limiting | `RateLimitMiddleware.js` | Works across PM2 clusters and Docker instances |

---
*Report generated for GradeMeAI / AssessQ Server Performance Optimization.*
