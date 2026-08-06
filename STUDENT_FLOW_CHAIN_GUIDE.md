# LoadMon — Visual Chain Load Test Setup Guide (Student Flow)

This guide provides field-by-field instructions to configure a complete 4-step Student User Flow load test in the **LoadMon UI** (`http://localhost:5173/configure` or `http://localhost:4000/configure`).

---

## 🔗 Visual Chain Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: Student Login                                                                 │
│ POST /api/auth/signin                                                                  │
│ Body: { "email": "{{ email }}", "password": "{{ password }}" }                          │
│ Captures ➔ set-cookie: {{ authCookie }} | $.user.id: {{ studentId }}                     │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Passes {{ studentId }} & {{ authCookie }}
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: Get Enrollments                                                                │
│ GET /api/enrollment/get-all/student/{{ studentId }}                                    │
│ Header: Cookie: {{ authCookie }}                                                       │
│ Captures ➔ $[0].classId: {{ classId }} (or $[0].class._id)                              │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Passes {{ classId }} & {{ authCookie }}
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: Open Selected Class                                                           │
│ GET /api/class/get/{{ classId }}                                                       │
│ Header: Cookie: {{ authCookie }}                                                       │
│ Think Time: 1s                                                                         │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Passes {{ classId }} & {{ authCookie }}
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: Get Class Tests                                                                │
│ GET /api/test/get-all/{{ classId }}                                                    │
│ Header: Cookie: {{ authCookie }}                                                       │
│ Think Time: 1s                                                                         │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Step-by-Step UI Input Instructions

Navigate to **Configure** page in the LoadMon sidebar (`/configure`).

### ⚙️ Global Scenario Settings
* **SCENARIO NAME**: `Student Full Flow: Login -> Enrollments -> Open Class -> Get Tests`

---

### 1️⃣ Step 1: Student Login

* **STEP NAME**: `Student Login`
* **THINK TIME (SECONDS DELAY AFTER REQUEST)**: `1`
* **METHOD**: `POST`
* **ENDPOINT PATH (SUPPORTS {{ VARNAME }})**: `/api/auth/signin`
* **Step Headers**:
  * Click **`+ Add Header`**
  * Key: `Content-Type` | Value: `application/json`
* **JSON BODY PAYLOAD (SUPPORTS {{ VARNAME }})**:
  ```json
  {
    "email": "{{ email }}",
    "password": "{{ password }}"
  }
  ```
* **Response Variable Extraction (capture)**:
  * Click **`+ Add Variable Capture`** (Rule 1):
    * **Extract From**: `Header`
    * **Header Name**: `set-cookie`
    * **Variable Name (`as`)**: `authCookie`
  * Click **`+ Add Variable Capture`** (Rule 2):
    * **Extract From**: `JSON Path`
    * **JSON Path**: `$.user.id`
    * **Variable Name (`as`)**: `studentId`

---

### 2️⃣ Step 2: Get Enrollments (Fetch Student's Enrolled Classes)

> 💡 **Note**: Immediately after login, AssessQ calls the Enrollment service (`GET /api/enrollment/get-all/student/:studentId`) to fetch all classes enrolled by the student, along with embedded class details (`name`, `code`, `level`) and `pendingTestIds`.

Click **`+ Add Step`** button at top right.

* **STEP NAME**: `Get Enrollments`
* **THINK TIME (SECONDS DELAY AFTER REQUEST)**: `1`
* **METHOD**: `GET`
* **ENDPOINT PATH (SUPPORTS {{ VARNAME }})**: `/api/enrollment/get-all/student/{{ studentId }}`
* **Step Headers**:
  * Click **`+ Add Header`**
  * Key: `Cookie` | Value: `{{ authCookie }}`
* **JSON BODY PAYLOAD**: *(Leave blank)*
* **Response Variable Extraction (capture)**:
  * Click **`+ Add Variable Capture`**:
    * **Extract From**: `JSON Path`
    * **JSON Path**: `$[0].classId`
    * **Variable Name (`as`)**: `classId`

---

### 3️⃣ Step 3: Open Selected Class

Click **`+ Add Step`** button at top right.

* **STEP NAME**: `Open Selected Class`
* **THINK TIME (SECONDS DELAY AFTER REQUEST)**: `1`
* **METHOD**: `GET`
* **ENDPOINT PATH (SUPPORTS {{ VARNAME }})**: `/api/class/get/{{ classId }}`
* **Step Headers**:
  * Click **`+ Add Header`**
  * Key: `Cookie` | Value: `{{ authCookie }}`
* **JSON BODY PAYLOAD**: *(Leave blank)*
* **Response Variable Extraction (capture)**: *(No capture rules needed)*

---

### 4️⃣ Step 4: Get Class Tests

Click **`+ Add Step`** button at top right.

* **STEP NAME**: `Get Class Tests`
* **THINK TIME (SECONDS DELAY AFTER REQUEST)**: `1`
* **METHOD**: `GET`
* **ENDPOINT PATH (SUPPORTS {{ VARNAME }})**: `/api/test/get-all/{{ classId }}`
* **Step Headers**:
  * Click **`+ Add Header`**
  * Key: `Cookie` | Value: `{{ authCookie }}`
* **JSON BODY PAYLOAD**: *(Leave blank)*
* **Response Variable Extraction (capture)**: *(No capture rules needed)*

---

## 📊 Data Manager Setup (Student Credentials CSV)

Before running the test, navigate to **Data Manager** (`/datamanager`):

1. Upload a CSV file named `userData.csv` containing student logins.
2. Ensure the CSV header has `email` and `password` columns:
   ```csv
   email,password
   student1@school.edu,Password123!
   student2@school.edu,Password123!
   student3@school.edu,Password123!
   ```
3. LoadMon will assign one row per Virtual User (VU), substituting `{{ email }}` and `{{ password }}` automatically into Step 1.

---

## 💾 Saving & Running

1. At the bottom of the **Configure** page, click **💾 Save Configuration**.
2. Navigate to **Dashboard** (`/`).
3. Set your target Virtual User arrival rate (e.g. 5 VUs/sec for 30s).
4. Click **🚀 Start Load Test**.
5. Observe step execution metrics and status codes live on the charts!
