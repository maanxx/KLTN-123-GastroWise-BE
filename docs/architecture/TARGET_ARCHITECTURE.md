# GASTROWISE – TARGET MICROSERVICES ARCHITECTURE SPECIFICATION
**Thesis:** Xây dựng hệ thống thông tin trải nghiệm ẩm thực thông minh (GastroWise)  
**Author:** Senior Software Architect & Tech Lead  
**Audit Date:** November 17, 2026  
**Status:** PHASE 0 COMPLETED — TARGET ARCHITECTURE FORMALIZED  

---

## 1. TARGET SYSTEM ARCHITECTURE TOPOLOGY

The target GastroWise platform decouples the monolith into three autonomous backend services mediated by a unified API Gateway:

```mermaid
graph TB
    subgraph Client Tier
        Mobile["Mobile App<br/>(React Native / Expo)"]
        CustomerWeb["Customer Web<br/>(Next.js 14)"]
        AdminWeb["Admin Web<br/>(Next.js 15)"]
    end

    subgraph API Gateway Tier
        Gateway["Nginx API Gateway (:80 / :8080)<br/>• Unified Public Reverse Proxy<br/>• CORS & Rate Limiting<br/>• Request Routing"]
    end

    subgraph Microservices Tier
        subgraph Core Service Domain
            Core["CORE SERVICE (:3001)<br/>• NestJS 11 Application<br/>• Users, Auth & RBAC<br/>• Restaurants & Menu Catalog<br/>• Reviews & Ratings<br/>• Taste DNA & Interactions"]
            DBCore[("gastro_core<br/>(MongoDB)")]
        end

        subgraph Planning Service Domain
            Planning["PLANNING SERVICE (:3003)<br/>• NestJS 11 Application<br/>• Itinerary Generation<br/>• Stop Sequence & Timetables<br/>• Dynamic Recalculation<br/>• Route History"]
            DBPlan[("gastro_planning<br/>(MongoDB)")]
        end

        subgraph Cognitive Intelligence Domain
            AI["AI SERVICE (:5000)<br/>• Python FastAPI Application<br/>• 4-Stage Hybrid Recommender<br/>• Google OR-Tools TSPTW Solver<br/>• ViSoBERT Sentiment Analysis<br/>• YOLOv11 Computer Vision"]
        end
    end

    Mobile -->|Public REST /api/v1/*| Gateway
    CustomerWeb -->|Public REST /api/v1/*| Gateway
    AdminWeb -->|Public REST /api/v1/*| Gateway

    Gateway -->|/api/v1/itineraries/*| Planning
    Gateway -->|/api/v1/*| Core

    Core --> DBCore
    Planning --> DBPlan

    Planning -->|Internal REST: /internal/restaurants/candidates| Core
    Planning -->|Internal REST: /routes/optimize| AI
    Core -->|Internal REST: /recommend/hybrid| AI
    Core -->|Internal REST: /analyze-sentiment| AI
    Core -->|Internal REST: /predict-food| AI
```

> [!NOTE]
> **Data Access Architectural Evolution (Interim vs Target State):**  
> - **Interim State (Phase 0–3):** AI Microservice reads directly from MongoDB Atlas `restaurants` collection using least-privilege credentials (`gastrowise_ai_service`).  
> - **Target State (Phase 4 / Production):** Zero Database Sharing is enforced. AI terminates all direct MongoDB connections; Core Service exclusively owns the catalog and streams candidate profiles directly in HTTP request payloads (`/recommend/hybrid`, `/routes/optimize`).

---

## 2. CLEAN ARCHITECTURE WITHIN INDEPENDENT SERVICES

Each NestJS service (`core-service` and `planning-service`) adheres to Clean Architecture layers to maintain high cohesion and low coupling:

```
apps/{service-name}/src/
├── domain/                  # Enterprise Business Rules
│   ├── entities/            # Domain Entities (e.g. Itinerary, Restaurant)
│   └── value-objects/       # GeoLocation, TimeWindow, TasteVector
│
├── application/             # Application Business Rules
│   ├── use-cases/           # GenerateItineraryUseCase, ReorderStopsUseCase
│   ├── dtos/                # Request & Response Data Transfer Objects
│   └── ports/               # Outbound interfaces (IRestaurantClient, IAiClient)
│
├── infrastructure/          # Frameworks & Drivers
│   ├── persistence/         # Mongoose Schemas & Repository Implementations
│   ├── http-clients/        # Axios clients for inter-service REST calls
│   └── config/              # Environment & Database connection factories
│
└── presentation/            # Interface Adapters
    ├── controllers/         # REST API Controllers
    ├── guards/              # JwtAuthGuard, RolesGuard, InternalAuthGuard
    └── interceptors/        # Logging, CorrelationId, ResponseFormat
```

---

## 3. MAIN BUSINESS FLOWS & SEQUENCE DIAGRAMS

### 3.1. Flow 1: Multi-Stop Itinerary Generation Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Mobile App User
    participant GW as API Gateway
    participant Plan as Planning Service (:3003)
    participant Core as Core Service (:3001)
    participant AI as AI Service (:5000)
    participant DB as gastro_planning DB

    User->>GW: POST /api/v1/itineraries/generate<br/>Headers: Authorization: Bearer <token><br/>Body: { prompt, budget: 250000, routing_mode: 'motorbike', start_time: '11:00', lat: 10.7769, lng: 106.7009 }
    GW->>Plan: Proxy -> POST /itineraries/generate (Forward User Context)
    
    Plan->>Core: GET /internal/restaurants/candidates?lat=10.7769&lon=106.7009&budget=250000&limit=15<br/>Header: X-Internal-Service-Key
    Core-->>Plan: 200 OK [Candidates List (Name, Coords, Price, MealType, Rating)]

    Plan->>AI: POST /routes/optimize<br/>Header: X-Internal-AI-Key<br/>Body: { start_location: [10.7769, 106.7009], budget: 250000, routing_mode: 'motorbike', candidates: [...] }
    
    alt AI Service Responds within 3500ms
        AI-->>Plan: 200 OK { stops: [...], total_distance_km: 4.8, total_duration_mins: 135, total_cost: 210000, co2_saved_kg: 1.6, algorithm_used: 'OR-Tools TSPTW' }
    else AI Service Times Out / Unavailable
        Plan->>Plan: Fallback: Execute Internal Gastronomic Greedy Heuristic
    end

    Plan->>DB: Save Itinerary Document (User ID, Stops Snapshot, Metrics)
    DB-->>Plan: Saved Document (_id: 6735c02b...)
    Plan-->>GW: 201 Created (ItineraryDTO)
    GW-->>User: 201 Created (ItineraryDTO)
```

---

### 3.2. Flow 2: Personalized Restaurant Discovery Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Customer Web User
    participant GW as API Gateway
    participant Core as Core Service (:3001)
    participant AI as AI Service (:5000)
    participant DB as gastro_core DB

    User->>GW: GET /api/v1/restaurants/recommended?lat=10.7769&lon=106.7009&limit=8
    GW->>Core: Proxy -> GET /restaurants/recommended
    
    Core->>DB: Fetch User Taste DNA Vector & Dietary Preferences
    DB-->>Core: Taste Vector [0.8, 0.3, 0.2, 0.5, 0.9, 0.1]
    
    Core->>AI: POST /recommend/hybrid<br/>Header: X-Internal-AI-Key<br/>Body: { user_id, user_gps: [10.7769, 106.7009], taste_vector, weather_type: 'rainy', limit: 8 }
    
    alt AI Responds
        AI-->>Core: 200 OK { total: 8, items: [ { id, score, taste_score, cf_score, match_reasons, explanation } ] }
        Core->>DB: Hydrate Candidates (_id IN candidateIds)
        DB-->>Core: Full Restaurant Documents
        Core->>Core: Merge AI Score & Explanatory Match Badges
    else AI Fails / Times out
        Core->>DB: Fallback: Query Top Rated Restaurants via 2dsphere index
        DB-->>Core: Top Restaurants
        Core->>Core: Attach standard fallback badges ("⭐ Đánh giá cao")
    end

    Core-->>GW: 200 OK (Recommended Restaurants List)
    GW-->>User: 200 OK (Recommended Restaurants List)
```

---

## 4. FAULT TOLERANCE & GRACEFUL DEGRADATION SPECIFICATION

The target architecture enforces comprehensive failure handling so that external or downstream service crashes never bring down the user experience:

| Failure Scenario | Impacted Flow | Detection Mechanism | Graceful Degradation Strategy |
| :--- | :--- | :---: | :--- |
| **AI Service Down / Unreachable** | Itinerary Route Optimization | HTTP 503 or 3,500ms timeout | Planning Service switches immediately to internal **Gastronomic Progression Heuristic** (Starter $\rightarrow$ Main $\rightarrow$ Dessert/Cafe) and generates valid tours. |
| **AI Service Down / Unreachable** | Hybrid Recommendations | HTTP 503 or 3,000ms timeout | Core Service switches immediately to **MongoDB 2dsphere Proximity & Rating Sort**, returning popular nearby venues. |
| **AI Service Down / Unreachable** | Review Sentiment Analysis | HTTP 503 or 2,000ms timeout | Core Service returns default `NEUTRAL` sentiment with score `0.5`, allowing reviews to be published without error. |
| **Core Service Down / Unreachable** | Itinerary Generation | HTTP 503 or 3,000ms timeout | Planning Service returns a clean 503 response: *"Hệ thống dữ liệu nhà hàng đang bảo trì. Vui lòng thử lại sau ít phút."* |
| **Planning Service Down** | Restaurant Discovery / Login | HTTP 502 / 504 from Gateway | Zero impact on Core Service. Users can browse restaurants, write reviews, and log in completely unaffected. |

