# ⚙️ Production Rate Limiting Guide: Sizing for Render (CPU & RAM)

**Target Infrastructure:** Render Web Service (Node.js Express + Mongoose)  
**Application:** GradeMeAI / AssessQ Backend  

---

## 1. Executive Overview

Setting production rate limits requires balancing **user experience**, **security (brute-force protection)**, and **hardware capacity limits (RAM & CPU limits on Render)**.

On Render, backend performance is constrained by:
1. **CPU Speed & Core Count:** Determines how many concurrent requests (especially CPU-bound operations like `bcrypt.compare` in login) your server can execute per second before requests start queuing.
2. **RAM Allocation:** Determines memory available for Node.js runtime, Mongoose buffers, image processing (`sharp`), and in-memory rate-limiting stores (`MemoryStore`).
3. **Proxy Setup:** Render uses an internal reverse proxy, requiring `app.set('trust proxy', 1)` to extract real user IP addresses (`X-Forwarded-For`).

---

## 2. Hardware Sizing & Capacity Calculations on Render

### A. General API Endpoints (I/O Bound: DB Read/Write)
- **Average Execution Time:** ~15ms - 50ms per request.
- **Memory Footprint:** ~150KB - 300KB per active HTTP connection context.

### B. Authentication Endpoints (`/api/auth/signin`) (CPU Bound)
- **Bcrypt Password Hashing Cost Factor (10 rounds):** Consumes **~50ms to 80ms of 100% CPU thread time** per request.
- **Hardware Capacity Limits (Max Logins/sec across ALL users combined):**
  - **0.5 vCPU (Render Starter - 512MB):** Max **~10–15 logins/sec** total capacity.
  - **1.0 vCPU (Render Standard - 2GB):** Max **~25–35 logins/sec** total capacity.
  - **2.0 vCPU (Render Pro - 4GB):** Max **~60–80 logins/sec** total capacity (using PM2 cluster mode).

### C. Rate Limit Memory Overhead in Node.js (`MemoryStore`)
- Each unique tracked IP in `express-rate-limit` takes **~250 bytes** of memory.
- Tracking **10,000 active unique IPs** in memory takes **~2.5 MB RAM** (extremely light).
- *Recommendation for 512MB Render instance:* `MemoryStore` is safe up to ~50,000 concurrent IPs (~12.5 MB). For high-scale deployments or multi-instance scaling, offload to **Redis**.

---

## 3. Render Tier-by-Tier Rate Limit Sizing Matrix

Use this reference table to configure your environment variables based on your Render plan:

| Render Instance Tier | Hardware Specs | Server Max RPS (General API) | Server Max Auth RPS (`bcrypt`) | Recommended `API_RATE_LIMIT_MAX` (per 1 minute / IP) | Recommended `AUTH_RATE_LIMIT_MAX` (per 15 minutes / IP) | Recommended Store |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Starter / Free** | 0.5 CPU / 512 MB RAM | ~50 RPS | ~10 logins/sec | **120 requests / min** | **15 requests / 15 min** | `MemoryStore` |
| **Standard** | 1.0 vCPU / 2 GB RAM | ~350 RPS | ~30 logins/sec | **300 requests / min** | **30 requests / 15 min** | `RedisStore` |
| **Pro** | 2.0 vCPU / 4 GB RAM | ~1,000 RPS | ~70 logins/sec | **600 requests / min** | **50 requests / 15 min** | `RedisStore` (PM2 Cluster) |
| **Pro Plus / Scale**| 4.0 vCPU / 8 GB RAM | ~2,500+ RPS | ~150 logins/sec | **1,200 requests / min** | **100 requests / 15 min** | `RedisStore` Cluster |

---

## 4. Recommended Rate Limit Configurations & Rationale

### A. Authentication Rate Limiter (`authLimiter`)
- **Purpose:** Prevent brute-force password guessing and protect CPU from bcrypt exhaustion attacks.
- **Recommended Window (`AUTH_RATE_LIMIT_WINDOW_MS`):** `15 * 60 * 1000` (15 minutes).
- **Recommended Max Requests (`AUTH_RATE_LIMIT_MAX`):**
  - **Production (Render 512MB / 2GB):** **15 to 30 requests per 15 minutes per IP**.  
    *Why?* Real human users rarely type the wrong password more than 5 times. 15–30 requests allows ample retries for legitimate users while stopping automated brute-force scripts from locking up CPU.
  - **Staging / Load Testing:** Set `DISABLE_RATE_LIMIT=true` or `AUTH_RATE_LIMIT_MAX=10000`.

### B. Global API Rate Limiter (`apiLimiter`)
- **Purpose:** Prevent single users or runaway frontend loops from overloading database queries and memory.
- **Recommended Window (`API_RATE_LIMIT_WINDOW_MS`):** `60 * 1000` (1 minute).
- **Recommended Max Requests (`API_RATE_LIMIT_MAX`):**
  - **Production (Render 512MB Starter):** **120 to 180 requests per minute per IP** (~2 to 3 req/sec per user).
  - **Production (Render 2GB Standard):** **300 to 600 requests per minute per IP** (~5 to 10 req/sec per user).
  - **Production (Render 4GB Pro):** **1,000+ requests per minute per IP**.

---

## 5. Production-Ready Code Implementation

Update your [RateLimitMiddleware.js](file:///e:/GradeMeAI/AssessQ/server/middlewares/RateLimitMiddleware.js) to dynamically read environment variables from Render:

```javascript
import rateLimit from 'express-rate-limit';

// Flag to bypass rate limits during load testing/staging
const isRateLimitDisabled = process.env.DISABLE_RATE_LIMIT === 'true';

/**
 * Global API Rate Limiter
 * Protects general backend routes from floods
 */
export const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10), // Default: 1 minute
    max: parseInt(process.env.API_RATE_LIMIT_MAX || '180', 10),              // Default: 180 req/min per IP
    skip: () => isRateLimitDisabled,
    message: {
        status: 429,
        message: "Too many requests from this IP. Please try again after a minute."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Strict Auth Rate Limiter
 * Protects login & registration endpoints from brute-force & CPU exhaustion
 */
export const authLimiter = rateLimit({
    windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10), // Default: 15 minutes
    max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '20', 10),                 // Default: 20 login attempts / 15 min per IP
    skip: () => isRateLimitDisabled,
    message: {
        status: 429,
        message: "Too many login attempts. Please try again after 15 minutes."
    },
    standardHeaders: true,
    legacyHeaders: false,
});
```

---

## 6. Render Environment Variables Setup (`.env`)

Add these environment variables to your **Render Environment Settings Dashboard**:

### Preset 1: Render Starter / Free Plan (512 MB RAM / 0.5 CPU)
```env
NODE_ENV=production
DISABLE_RATE_LIMIT=false
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX=120
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=15
```

### Preset 2: Render Standard Plan (2 GB RAM / 1 vCPU)
```env
NODE_ENV=production
DISABLE_RATE_LIMIT=false
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX=300
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=30
```

### Preset 3: Staging / Load Testing Mode (Artillery Load Test)
```env
NODE_ENV=staging
DISABLE_RATE_LIMIT=true
```

---

## 7. Critical Render Proxy Requirement

In `[app.js](file:///e:/GradeMeAI/AssessQ/server/app.js#L24)`:
```javascript
// MUST be set on Render so Express reads the real user IP from header 'X-Forwarded-For'
app.set('trust proxy', 1);
```
*If `trust proxy` is NOT enabled on Render, all users share Render's internal proxy IP (`10.x.x.x`), causing 1 user to exhaust the rate limit for ALL users on the platform!*

---
*Guide prepared for GradeMeAI / AssessQ Render Production Deployment.*
