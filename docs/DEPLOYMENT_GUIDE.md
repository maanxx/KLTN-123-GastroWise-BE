# GASTROWISE — MICROSERVICES DEPLOYMENT & OPERATION GUIDE

**Document:** `docs/DEPLOYMENT_GUIDE.md`  
**Repository:** [KLTN-123-GastroWise-BE](https://github.com/maanxx/KLTN-123-GastroWise-BE)  
**Target Topology:** Core Service (:3001) + Planning Service (:3003) + AI Microservice (:5000) + Nginx Gateway (:8080)  
**Author:** Senior Software Architect & Backend Tech Lead  
**Last Updated:** November 20, 2026  

---

## 1. ARCHITECTURE TOPOLOGY

```
                  ┌─────────────────────────────────────────┐
                  │       CLIENT APPLICATIONS               │
                  │  Mobile (Expo 57) / Web / Admin (Next)  │
                  └───────────────────┬─────────────────────┘
                                      │ REST /api/v1/*
                                      ▼
                  ┌─────────────────────────────────────────┐
                  │     NGINX API GATEWAY (:8080)           │
                  │  - Routing & Path Rewrites              │
                  │  - Rate Limiting & CORS                 │
                  │  - Correlation ID Injection             │
                  └─────────┬─────────────────────┬─────────┘
                            │                     │
      /api/v1/itineraries/* │                     │ /api/v1/*
                            ▼                     ▼
              ┌───────────────────────┐   ┌───────────────────────┐
              │ PLANNING SERVICE      │   │ CORE SERVICE          │
              │ Port: 3003            │   │ Port: 3001            │
              │ DB: gastro_planning   │   │ DB: gastro_core       │
              └───────────┬───────────┘   └───────────┬───────────┘
                          │                           │
                          │ Core Internal API         │ AI REST
                          │ (X-Internal-Service-Key)  │ (X-Internal-AI-Key)
                          ├──────────────────────────►│
                          │                           │
                          │ AI Route Optimizer        │ AI Recommender / Vision
                          │ (X-Internal-AI-Key)       │
                          ▼                           ▼
              ┌───────────────────────────────────────────────────┐
              │             AI MICROSERVICE (FastAPI :5000)       │
              │  OR-Tools TSPTW, Hybrid SVD, ViSoBERT, YOLOv11m   │
              └───────────────────────────────────────────────────┘
```

---

## 2. SERVICE DIRECTORY & ARTIFACT LAYOUT

| Service / Component | Directory | Bootstrap Entry | Default Port | Database Ownership |
| :--- | :--- | :--- | :---: | :--- |
| **API Gateway** | `nginx/` | `nginx/nginx.conf` | `8080` | None (Stateless Reverse Proxy) |
| **Core Service** | `apps/core-service/` | `apps/core-service/src/main.ts` | `3001` | `gastro_core` (Exclusive) |
| **Planning Service**| `apps/planning-service/`| `apps/planning-service/src/main.ts` | `3003` | `gastro_planning` (Exclusive) |
| **Shared Transport**| `libs/shared/` | `libs/shared/src/index.ts` | — | Zero DB (Pure Contracts & Utils) |
| **AI Microservice** | `../KLTN-123-GastroWise-AI/` | `main.py` | `5000` | Interim Read-Only (`gastrowise.restaurants`) |

---

## 3. LOCAL DEVELOPMENT WORKFLOW (WITHOUT DOCKER)

### 3.1. Prerequisites
- Node.js `v24.x` or `v22.x`
- npm `v11.x`
- Python `3.11.x` or `3.12.x`
- MongoDB running locally on `localhost:27017` or MongoDB Atlas URI

### 3.2. Setup Environment Variables
Copy root environment template:
```bash
cp .env.example .env
```
Ensure the following variables are present in `.env`:
```ini
JWT_SECRET=your_jwt_secret_min_32_characters_here
INTERNAL_SERVICE_KEY=gastrowise_internal_key_2026
INTERNAL_AI_KEY=gastrowise_ai_key_2026
MONGODB_URI_CORE=mongodb://localhost:27017/gastro_core
MONGODB_URI_PLANNING=mongodb://localhost:27017/gastro_planning
AI_SERVICE_URL=http://localhost:5000
CORE_SERVICE_URL=http://localhost:3001
```

### 3.3. Compile All Services
```bash
# Build shared library, core-service, and planning-service in order
npm run build:all
```

### 3.4. Run Services Concurrently

**Terminal 1 — Core Service (Port 3001):**
```bash
npm run start:core:dev
```
Health verification: `curl http://localhost:3001/health`  
Returns: `{"status":"UP","service":"core-service",...}`

**Terminal 2 — Planning Service (Port 3003):**
```bash
npm run start:planning:dev
```
Health verification: `curl http://localhost:3003/health`  
Returns: `{"status":"UP","service":"planning-service",...}`

**Terminal 3 — AI Microservice (Port 5000):**
```bash
cd ../KLTN-123-GastroWise-AI
uvicorn main:app --host 0.0.0.0 --port 5000 --reload
```
Health verification: `curl http://localhost:5000/`

---

## 4. DOCKER COMPOSE DEPLOYMENT

### 4.1. Build and Run Entire Topology
```bash
# From KLTN-123-GastroWise-BE root:
docker-compose up --build -d
```

### 4.2. Verify Container Health
```bash
docker-compose ps
```

| Service | Port Exposed | Health Endpoint |
| :--- | :---: | :--- |
| `gastrowise-nginx-gateway` | `8080` | `http://localhost:8080/health` |
| `gastrowise-core-service` | `3001` (internal) | `http://localhost:3001/health` |
| `gastrowise-planning-service` | `3003` (internal) | `http://localhost:3003/health` |
| `gastrowise-ai-service` | `5000` (internal) | `http://localhost:5000/` |

---

## 5. API ROUTING & GATEWAY CONTRACTS

All client requests should target `http://localhost:8080` (or production Gateway domain):

| Request Path | Gateway Action | Target Upstream |
| :--- | :--- | :--- |
| `GET /health` | Handled directly by Nginx | Returns 200 JSON |
| `/api/v1/itineraries/*` | Proxied with 30s timeout | `planning-service:3003` |
| `/api/v1/auth/*` | Proxied with rate limiting (5 req/s) | `core-service:3001` |
| `/api/v1/*` (all other) | Proxied with rate limiting (30 req/s) | `core-service:3001` |
| `/itineraries/*` (legacy) | Rewritten to `/api/v1/itineraries/*` | `planning-service:3003` |
| `/restaurants/*` (legacy) | Rewritten to `/api/v1/restaurants/*` | `core-service:3001` |

---

## 6. MUTUAL AUTHENTICATION & SECURITY

### 6.1. Planning $\rightarrow$ Core Internal API
All calls from Planning to Core's `/internal/*` routes must include:
```http
X-Internal-Service-Key: <INTERNAL_SERVICE_KEY>
X-Correlation-Id: <uuid>
```
Validated by `InternalAuthGuard` using constant-time comparison (`crypto.timingSafeEqual`).

### 6.2. Core / Planning $\rightarrow$ AI Microservice
All calls to FastAPI endpoints must include:
```http
X-Internal-AI-Key: <INTERNAL_AI_KEY>
X-Correlation-Id: <uuid>
```
Validated by FastAPI `verify_internal_ai_key` dependency using `secrets.compare_digest`.

### 6.3. User / Client Authentication
Public endpoints use Bearer JWT tokens signed with `JWT_SECRET`. Both Core and Planning services validate JWT tokens independently without database lookups.

