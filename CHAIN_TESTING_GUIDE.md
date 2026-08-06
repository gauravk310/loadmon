# 🔗 Chain Load Testing — Setup & Run Guide

---

## 1. Start the Servers

Open **two terminals** and run:

**Terminal 1 — Backend**
```bash
cd e:\loadmon\backend
node index.js
```
Backend starts at → `http://localhost:8000`

**Terminal 2 — Frontend**
```bash
cd e:\loadmon\ui
npm run dev
```
Frontend starts at → `http://localhost:5173`

---

## 2. Configure Your Target Application

1. Open the app in your browser at `http://localhost:5173`
2. Click **⚙️ Configure** in the sidebar
3. Under **Environment & Target Applications**, select or add your app:
   - **App Origin URL** → e.g. `https://grademeai-qabe.onrender.com`
   - **Target Server URL** → e.g. `https://grademeai-qabe.onrender.com`
   - **Hostname** → e.g. `grademeai-qabe.onrender.com`
4. Click **💾 Save Settings**

---

## 3. Upload Student Data

1. Click **📂 Data Manager** in the sidebar
2. Upload your `userData.json` file (list of students with `email` and `password`)

Example format:
```json
[
  { "email": "student0001@loadtesting.com", "password": "GradeMeAI" },
  { "email": "student0002@loadtesting.com", "password": "GradeMeAI" }
]
```

---

## 4. Build Your Chain

1. Click **🔗 Chain Builder** in the sidebar
2. Enter a **Chain Name** (e.g. `Student Login Flow`)
3. Select your **Target Application** from the dropdown

---

### Step 1 — Configure the Login Step

Fill in the first step card:

| Field | Value |
|---|---|
| Step Name | `Student Login` |
| Method | `POST` |
| Endpoint | `/api/auth/signin` |
| Header | `Content-Type: application/json` |
| Body | `{ "email": "student0001@loadtesting.com", "password": "GradeMeAI" }` |

Click **▶ Run Step 1**

✅ You will see the live response JSON, e.g.:
```json
{
  "success": true,
  "message": "Logged in successfully",
  "user": {
    "id": "6a7226d7b003b9c339ea7ad2",
    "firstName": "Student",
    "lastName": "0001",
    "email": "student0001@loadtesting.com"
  }
}
```

The builder will **automatically extract** all keys:

`success` · `message` · `user.id` · `user.firstName` · `user.lastName` · `user.email`

These are now available as `{{variables}}` in all subsequent steps.

---

### Step 2 — Add the Enrollment Step

Click **➕ Add Step** to add a second step.

| Field | Value |
|---|---|
| Step Name | `Get Enrollments` |
| Method | `GET` |
| Endpoint | `/api/enrollment/get-all/student/{{user.id}}` |

**How to insert the variable:**

Type `{{` after `student/` in the endpoint field:
```
/api/enrollment/get-all/student/{{
```
A dropdown appears showing all keys extracted from Step 1:
- `{{success}}` ← Step 1: Student Login
- `{{message}}` ← Step 1: Student Login
- `{{user.id}}` ← Step 1: Student Login
- `{{user.firstName}}` ← Step 1: Student Login

Click **`{{user.id}}`** → endpoint becomes:
```
/api/enrollment/get-all/student/{{user.id}}
```

> **Note:** You can also type `{{` in **Header values** and **Request Body** to reference variables from any previous step.

Click **▶ Run Step 2**

The builder will:
1. Execute Step 1 (login) first to get the real `user.id`
2. Execute Step 2 with the resolved URL, e.g.:
   ```
   https://grademeai-qabe.onrender.com/api/enrollment/get-all/student/6a7226d7b003b9c339ea7ad2
   ```

✅ You'll see the real enrollment response. New keys from this response are extracted and become available for Step 3.

---

### Add More Steps (Optional)

Repeat the same process. Every new step can reference variables from **all previous steps**.

---

## 5. Save the Chain

Click **💾 Save Chain** — the chain is saved to `backend/chains.json` and appears in the **Saved Chains** panel on the left side of the Chain Builder page.

---

## 6. Run Chain Load Test from the Dashboard

1. Click **⚡ Dashboard** in the sidebar
2. Find the **🔗 Chain** dropdown in the top-right header area
3. Select your saved chain (e.g. `Student Login Flow`)

A **Chain banner** appears confirming your steps and target server.

4. Set your **load parameters** (shown inline next to the chain selector):
   - **Duration (s)** → e.g. `10` (run for 10 seconds)
   - **Arrival Rate /s** → e.g. `2` (spawn 2 new virtual users per second)

5. Click **🔗 Start Chain Test**

---

## 7. Monitor Live Progress

While the test runs, the **Live Progress** panel streams every request in real time:

| 👤 User | 🌐 API Endpoint | Status |
|---|---|---|
| `student0001@loadtesting.com` | `POST /api/auth/signin` | ✅ 200 |
| `student0001@loadtesting.com` | `GET /api/enrollment/get-all/student/6a7226d7...` | ✅ 200 |
| `student0002@loadtesting.com` | `POST /api/auth/signin` | ✅ 200 |
| `student0002@loadtesting.com` | `GET /api/enrollment/get-all/student/...` | ⏳ |
| `student0003@loadtesting.com` | `POST /api/auth/signin` | ❌ 500 |

> **Important:** The **actual resolved URL** is shown with the real student ID substituted in — not the `{{user.id}}` template.

The **User & Step Execution Matrix** below the ticker shows the full grid of every virtual user × every step with timing in milliseconds.

---

## 8. Simple (Non-Chain) Load Testing

To run a regular single-endpoint load test (no chain):

1. In the Dashboard, set the **🔗 Chain** dropdown to `None (Simple)`
2. Select a **phase preset**: Quick 30s / Moderate 2m / Heavy / Stress
3. Click **▶ Start Test**

The live progress ticker shows one row per user per request.

---

## File Reference

| File | Purpose |
|---|---|
| `backend/chains.json` | Saved chains storage |
| `backend/routes/chains.js` | Chain CRUD + run-step proxy API |
| `backend/routes/tests.js` | Load test execution engine |
| `ui/src/pages/ChainBuilder.jsx` | Chain Builder UI page |
| `ui/src/pages/Dashboard.jsx` | Dashboard with chain selector & live ticker |
| `ui/src/pages/Configure.jsx` | Environment & settings page |
| `ui/src/context/AppContext.jsx` | Global state — chains, selectedChainId |
