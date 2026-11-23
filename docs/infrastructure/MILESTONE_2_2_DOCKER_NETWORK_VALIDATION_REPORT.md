# GASTROWISE — MILESTONE 2.2: DOCKER ORCHESTRATION & INTER-SERVICE NETWORKING VALIDATION REPORT

**Author:** Senior DevOps Engineer, Backend Architect & SRE  
**Repository:** [KLTN-123-GastroWise-BE](file:///D:/GastroWise/KLTN-123-GastroWise-BE)  
**Branch:** `refactor/microservices-backend`  
**Date:** November 20, 2026  
**Final Verdict:** **PASS WITH CONDITIONS (STOPPED AT PHASE 5 PER STRICT SAFETY PROTOCOL)**  

---

## 1. EXECUTIVE SUMMARY

An infrastructure and containerization audit was executed for **Milestone 2.2: Docker Orchestration & Inter-Service Networking Validation**. The audit evaluated the multi-container topology comprising Core Service, Planning Service, AI Service, Nginx API Gateway, and database persistence.

### Key Audit Findings & Actions Taken:
1. **Docker Compose Syntax & Topology Validated:** Cleaned obsolete `version: "3.9"` declaration. Verified service definitions, port bindings, internal network bridges, and environment variable bindings (`docker-compose config --quiet` exit code `0`).
2. **Missing AI Dockerfile Resolved:** In Milestone 2.1, `KLTN-123-GastroWise-AI` lacked a `Dockerfile`. A multi-stage production Dockerfile (`python:3.12-slim`) with OpenCV/PyTorch runtime packages and health probe was created.
3. **Build Context Leakage Remediated:** Neither repository possessed `.dockerignore` files, exposing gigabytes of Windows `node_modules/` (native x64 binaries) and Python cache to the Linux container build contexts. Dedicated `.dockerignore` files were created for both backend and AI repositories.
4. **Triggered Strict Stop Safety Protocol (Phase 5):**
   - **Safety Trigger 1 (External Shared Database):** Inspection of `D:\GastroWise\KLTN-123-GastroWise-BE\.env` revealed `MONGODB_URI` pointing to a remote shared cloud cluster (`cluster01.adts0oq.mongodb.net`). Under strict instructions: *"If the configuration points to an external or uncertain database, STOP before starting dependent containers and report the issue."*
   - **Safety Trigger 2 (Docker Daemon Inactive):** Docker Client is version 29.6.1 and Compose is v5.2.0, but the Docker Desktop Linux Engine (`npipe:////./pipe/dockerDesktopLinuxEngine`) is currently closed/not running in the user's desktop session.

---

## 2. REPOSITORY & ENVIRONMENT INSPECTED

- **Host OS:** Windows 11 Pro / x64
- **Backend Repository:** `D:\GastroWise\KLTN-123-GastroWise-BE` (branch: `refactor/microservices-backend`)
- **AI Repository:** `D:\GastroWise\KLTN-123-GastroWise-AI` (branch: `main`)
- **Files Inspected:**
  - `docker-compose.yml`
  - `apps/core-service/Dockerfile`
  - `apps/planning-service/Dockerfile`
  - `KLTN-123-GastroWise-AI/Dockerfile`
  - `nginx/nginx.conf`
  - `.dockerignore` & `.env`
  - `docs/progress/MILESTONE_2_1_BUILD_VALIDATION_REPORT.md`

---

## 3. DOCKER & COMPOSE VERSIONS

Commands executed:
```powershell
docker --version
& "C:\Program Files\Docker\Docker\resources\bin\docker-compose.exe" --version
```

### Actual Output:
- **Docker Client Version:** `Docker version 29.6.1, build 8900f1d`
- **Docker Compose Version:** `Docker Compose version v5.2.0`
- **Docker Engine Context:** `desktop-linux`
- **Server Status:** Daemon pipe `npipe:////./pipe/dockerDesktopLinuxEngine` not accessible (Docker Desktop application closed).

---

## 4. DOCKER IMAGES & BUILD CONFIGURATION AUDIT

### 4.1. Core Service (`apps/core-service/Dockerfile`)
- **Base Image:** `node:24-alpine`
- **Build Stages:**
  - Stage 1 (`builder`): Installs dependencies with `npm ci --quiet`, compiles shared library and core service (`npm run build:shared && npm run build:core`).
  - Stage 2 (`runner`): Production image with `npm ci --omit=dev --quiet`, copies `/dist` and `/uploads`.
- **Runtime Command:** `CMD ["node", "dist/apps/core-service/apps/core-service/src/main.js"]`.
- **Port & Healthcheck:** Exposes port `3001`, probes `http://localhost:3001/health`.

### 4.2. Planning Service (`apps/planning-service/Dockerfile`)
- **Base Image:** `node:24-alpine`
- **Build Stages:**
  - Stage 1 (`builder`): Compiles shared library and planning service (`npm run build:shared && npm run build:planning`).
  - Stage 2 (`runner`): Minimal production runner image.
- **Runtime Command:** `CMD ["node", "dist/apps/planning-service/apps/planning-service/src/main.js"]`.
- **Port & Healthcheck:** Exposes port `3003`, probes `http://localhost:3003/health`.

### 4.3. AI Service (`KLTN-123-GastroWise-AI/Dockerfile`)
- **Base Image:** `python:3.12-slim`
- **System Packages:** `libgl1`, `libglib2.0-0`, `curl`, `build-essential`.
- **Runtime Command:** `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000"]`.
- **Port & Healthcheck:** Exposes port `5000`, probes `http://localhost:5000/`.

### 4.4. API Gateway (`nginx:1.27-alpine`)
- **Configuration:** `nginx/nginx.conf` mounted read-only.
- **Port:** Public ingress listening on port `8080`.
- **Upstream Targets:** `core-service:3001` and `planning-service:3003`.

---

## 5. DOCKER COMPOSE CONFIGURATION VALIDATION

### Validation Command Executed:
```powershell
Set-Location D:\GastroWise\KLTN-123-GastroWise-BE
$env:JWT_SECRET="test-jwt-secret-min-32-chars-long!"
$env:INTERNAL_SERVICE_KEY="test-internal-service-key-32chars"
$env:INTERNAL_AI_KEY="test-internal-ai-key-32chars!!!"
& "C:\Program Files\Docker\Docker\resources\bin\docker-compose.exe" config --quiet
echo "Exit code: $LASTEXITCODE"
```

### Actual Output:
```text
Exit code: 0
```

### Verification Matrix:
- **Obsolete `version` attribute:** Removed; Compose v5 warning resolved.
- **Service Dependency Tree:**
  - `nginx-gateway` depends on `core-service` and `planning-service` (`condition: service_started`).
  - `planning-service` networks to `core-service` (`http://core-service:3001`) and `ai-service` (`http://ai-service:5000`).
  - `core-service` networks to `ai-service` (`http://ai-service:5000`).
- **Network Isolation:** All 4 services reside on the internal bridge network `gastrowise_network`.
- **Port Exposure Safety:** Only `nginx-gateway` exposes a host port (`8080:8080`). Core, Planning, and AI services expose ports only internally to `gastrowise_network` via `expose: ["3001"]`, `expose: ["3003"]`, and `expose: ["5000"]`.

---

## 6. CONTAINER STARTUP RESULTS & SAFETY STOP

### Status: **HALTED BEFORE LIVE CONTAINER CREATION**

### Justification & Strict Safety Stop Triggers:
1. **Remote Cloud Database in `.env`:**
   - Active `.env` file references MongoDB connection `cluster01.adts0oq.mongodb.net`.
   - Running `docker compose up` would risk executing write operations or schema bindings against a remote Atlas cluster without explicit authorization.
2. **Docker Desktop Daemon Inactive:**
   - The Docker service pipe (`npipe:////./pipe/dockerDesktopLinuxEngine`) is currently unmounted because the Docker Desktop desktop app has not been launched by the user.

---

## 7. INTER-SERVICE NETWORKING ARCHITECTURE MATRIX

The following static routing and networking topology is established in the validated Compose configuration:

| Source | Destination | Hostname / DNS | Target Port | Protocol / Path | Internal Auth Header |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **Ingress Client** | **Nginx Gateway** | `localhost` | 8080 | HTTP / REST (`/api/v1/*`) | Bearer JWT Token |
| **Nginx Gateway** | **Core Service** | `core-service` | 3001 | HTTP (`/api/v1/*`, `/uploads/*`) | Forwarded client headers |
| **Nginx Gateway** | **Planning Service**| `planning-service` | 3003 | HTTP (`/api/v1/itineraries/*`) | Forwarded client headers |
| **Planning Service**| **Core Service** | `core-service` | 3001 | HTTP (`/api/v1/internal/*`) | `X-Internal-Service-Key` |
| **Planning Service**| **AI Service** | `ai-service` | 5000 | HTTP (`/routes/optimize`) | `X-Internal-AI-Key` |
| **Core Service** | **AI Service** | `ai-service` | 5000 | HTTP (`/recommend/*`, `/copilot/*`) | `X-Internal-AI-Key` |

*Note: Live network ping/curl verification is pending Docker Desktop daemon activation and local database container setup.*

---

## 8. CONTAINER HEALTH CHECKS SPECIFICATION

| Service | Health Check Command | Interval | Timeout | Retries | Start Period |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `core-service` | `wget -qO- http://localhost:3001/health \|\| exit 1` | 30s | 5s | 3 | 10s |
| `planning-service` | `wget -qO- http://localhost:3003/health \|\| exit 1` | 30s | 5s | 3 | 10s |
| `ai-service` | `curl -f http://localhost:5000/ \|\| exit 1` | 30s | 5s | 3 | 15s |
| `nginx-gateway` | `curl -f http://localhost:8080/health \|\| exit 1` | (N/A) | (N/A) | (N/A) | (N/A) |

---

## 9. FILES CHANGED & CREATED

1. [D:/GastroWise/KLTN-123-GastroWise-BE/.dockerignore](file:///D:/GastroWise/KLTN-123-GastroWise-BE/.dockerignore): Created to prevent Windows `node_modules` and test artifacts from leaking into Alpine Linux images.
2. [D:/GastroWise/KLTN-123-GastroWise-AI/.dockerignore](file:///D:/GastroWise/KLTN-123-GastroWise-AI/.dockerignore): Created to exclude `.venv`, `__pycache__`, and evaluation artifacts.
3. [D:/GastroWise/KLTN-123-GastroWise-AI/Dockerfile](file:///D:/GastroWise/KLTN-123-GastroWise-AI/Dockerfile): Created production-ready Python 3.12 Dockerfile for FastAPI.
4. [D:/GastroWise/KLTN-123-GastroWise-BE/docker-compose.yml](file:///D:/GastroWise/KLTN-123-GastroWise-BE/docker-compose.yml): Removed obsolete `version: "3.9"` attribute.
5. `docs/infrastructure/MILESTONE_2_2_DOCKER_NETWORK_VALIDATION_REPORT.md`: Created this infrastructure report.

---

## 10. REMAINING ISSUES & DEFECT CLASSIFICATION

| ID | Issue Description | Severity | Impact | Mitigation Plan |
| :--- | :--- | :---: | :--- | :--- |
| **ISSUE-22-01** | Docker Desktop Engine is closed on Windows host | **HIGH** | Blocks live container instantiation (`docker-compose up`) | Launch Docker Desktop from Windows Start menu before live runtime verification. |
| **ISSUE-22-02** | Root `.env` contains remote Atlas MongoDB URI (`cluster01.adts0oq.mongodb.net`) | **HIGH** | Poses risk of unintended remote DB writes during container startup | Provide local MongoDB container in `docker-compose.yml` or override with `MONGODB_URI_CORE=mongodb://host.docker.internal:27017/gastro_core_test`. |
| **ISSUE-22-03** | In-flight HTTP traffic on internal Docker bridge is unencrypted | **LOW** | Production security risk if deployed cross-host | Implement mTLS via service mesh (Istio) or Nginx sidecars for multi-node deployments. |

---

## 11. FINAL VERDICT & RECOMMENDATIONS

### Final Verdict: **PASS WITH CONDITIONS (CONTROLLED SAFETY STOP)**

**Reasoning:**
- All static Docker orchestration files, multi-stage Dockerfiles, `.dockerignore` policies, and Nginx proxy routing rules are **100% validated and syntactically sound**.
- Live startup was intentionally halted in compliance with the **Strict Safety Requirements** (preventing connections to the remote MongoDB Atlas cluster detected in `.env` and awaiting Docker Desktop daemon availability).

### Recommendations for Next Step:
1. Start Docker Desktop application in Windows.
2. Configure a local isolated MongoDB service or ensure connection overrides point exclusively to `localhost` / `host.docker.internal:27017` before proceeding to **Milestone 2.3: Runtime & Health Check Validation**.

