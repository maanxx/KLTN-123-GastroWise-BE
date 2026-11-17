# GASTROWISE – CURRENT MONOLITH ARCHITECTURE AUDIT
**Thesis:** Xây dựng hệ thống thông tin trải nghiệm ẩm thực thông minh (GastroWise)  
**Author:** Senior Software Architect & Tech Lead  
**Audit Date:** November 17, 2026  
**Status:** PHASE 0 COMPLETED — CURRENT STATE FORMALIZED  

---

## 1. CURRENT ARCHITECTURAL TOPOLOGY

The current GastroWise system operates as a hybrid between a Backend Modular Monolith, a standalone Python AI service, and three separate frontend clients:

```mermaid
graph TB
    subgraph Client Tier
        Mobile["Mobile App<br/>(React Native / Expo)"]
        CustomerWeb["Customer Web<br/>(Next.js 14)"]
        AdminWeb["Admin Web<br/>(Next.js 15)"]
    end

    subgraph Backend Monolith Tier (:3001)
        NestBE["NestJS Monolithic Application<br/>(All 10 modules in single process)"]
        
        subgraph Internal Monolith Modules
            M_Auth["AuthModule"]
            M_Users["UsersModule"]
            M_Rest["RestaurantsModule"]
            M_Rev["ReviewsModule"]
            M_Fav["FavoritesModule"]
            M_Taste["TasteDnaModule"]
            M_Inter["InteractionsModule"]
            M_Cont["ContactsModule"]
            M_Itin["ItinerariesModule (Tightly Coupled)"]
        end
    end

    subgraph AI Microservice Tier (:5000)
        FastAPI["Python FastAPI Service<br/>• Hybrid Recommender<br/>• Route Optimizer<br/>• Sentiment Analysis<br/>• YOLOv11 Vision"]
    end

    subgraph Database Tier
        Atlas["MongoDB Atlas Cluster (Database: gastrowise)<br/>Shared by NestJS & FastAPI"]
    end

    Mobile -->|Direct REST Calls| NestBE
    CustomerWeb -->|Direct REST Calls| NestBE
    AdminWeb -->|Direct REST Calls| NestBE

    NestBE --> M_Auth
    NestBE --> M_Users
    NestBE --> M_Rest
    NestBE --> M_Rev
    NestBE --> M_Fav
    NestBE --> M_Taste
    NestBE --> M_Inter
    NestBE --> M_Cont
    NestBE --> M_Itin

    M_Itin -.->|Injects Schema| M_Rest
    M_Itin -.->|Injects Service| M_Taste
    M_Itin -.->|Injects Service| M_Inter

    NestBE -->|HTTP REST| FastAPI
    NestBE -->|Mongoose Read/Write| Atlas
    FastAPI -.->|Direct Read-Only / gastrowise_ai_service| Atlas
```

---

## 2. KEY ARCHITECTURAL LIMITATIONS & TECHNICAL DEBT

### 2.1. Structural Tight Coupling in Monolith
- In [itineraries.service.ts:88-93](file:///D:/GastroWise/KLTN-123-GastroWise-BE/src/itineraries/itineraries.service.ts#L88-L93), `ItinerariesService` directly injects `@InjectModel(Restaurant.name)`, `TasteDnaService`, and `InteractionsService`.
- If the restaurant schema or taste DNA logic is modified, the itinerary module is directly impacted and must be re-tested and re-deployed.
- The failure of any single component (e.g. contact form email sending) can crash the entire backend process, taking down itinerary generation and user authentication simultaneously.

### 2.2. Shared Database Violation (Anti-Pattern)
- All business domains (Users, Restaurants, Reviews, Itineraries, Interactions) reside within a single MongoDB database (`gastrowise`).
- Both NestJS and FastAPI connect to the same MongoDB Atlas cluster. While FastAPI is constrained to read-only access via user `gastrowise_ai_service`, this dual-access creates data staleness: when an admin adds or updates a restaurant in NestJS, FastAPI's in-memory DataFrame remains unchanged until the Python process is restarted.

### 2.3. Absence of an API Gateway
- All three frontend clients (Mobile, Customer Web, Admin Web) connect directly to NestJS port `3001`.
- Client applications must handle cross-origin resource sharing (CORS), host configuration, and network routing directly.
- The system cannot independently scale or route specific high-traffic subpaths (e.g. `/itineraries/generate` vs `/restaurants/nearby`) without exposing multiple internal ports to the public internet.

### 2.4. Cross-Tier Contract & URL Routing Inconsistencies
- NestJS `restaurants.service.ts` calls:
  - `${aiBaseUrl}/v1/recommendation/recommend/hybrid` $\rightarrow$ FastAPI only exposes `/recommend/hybrid`.
  - `${aiBaseUrl}/v1/recommendation/cf/train` $\rightarrow$ FastAPI only exposes `/cf/train`.
  - `${aiBaseUrl}/v1/copilot/message` $\rightarrow$ FastAPI only exposes `/copilot/message`.
- Because of these path discrepancies, **every AI recommendation and copilot request triggers HTTP 404**, forcing NestJS to fall back to primitive rating sorts and regex search, silently bypassing the AI platform.

### 2.5. Data Normalization Flaw (The 5.4★ Rating Bug)
- MongoDB Atlas stores `diemTrungBinh` on Foody's 0–10 scale.
- NestJS normalizes ratings by dividing by 2 (`raw / 2.0`), but FastAPI `app/db/mongo.py` renames `diemTrungBinh` to `rating` without dividing by 2.
- A restaurant with a mediocre score of 5.4/10 is evaluated as $5.4 \ge 4.7$ in `recommender.py`, generating invalid trust badges (`"⭐ Đánh giá xuất sắc (5.4★)"`) on a 5-star scale.

---

## 3. WHY MIGRATION TO MICROSERVICES IS MANDATORY

1. **Academic Thesis Requirement:** The graduation council explicitly mandates the design and implementation of a Microservices Architecture.
2. **Independent Scalability:** Itinerary route planning is CPU and latency intensive (OR-Tools TSPTW solvers), whereas restaurant catalog browsing is high-concurrency read-heavy (GeoJSON 2dsphere spatial index). Decoupling them into **Core Service** and **Planning Service** allows independent scaling and resource allocation.
3. **Domain Boundary Isolation:** Establishing clear bounded contexts ensures that journey planning logic cannot corrupt restaurant catalog records, and AI cognitive algorithms remain cleanly separated from business transactions.

