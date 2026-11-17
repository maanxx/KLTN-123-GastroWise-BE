# GASTROWISE – SERVICE BOUNDARIES & ANTI-CORRUPTION LAYER SPECIFICATION
**Thesis:** Xây dựng hệ thống thông tin trải nghiệm ẩm thực thông minh (GastroWise)  
**Author:** Senior Software Architect & Tech Lead  
**Audit Date:** November 17, 2026  
**Status:** PHASE 0 COMPLETED — BOUNDARY PROTOCOLS FORMALIZED  

---

## 1. SERVICE BOUNDARY PRINCIPLES & DECOUPLING STRATEGY

To preserve the independence of Core, Planning, and AI services, all inter-service boundaries adhere to three architectural rules:

1. **Zero Database Sharing:** No service connects to or executes queries against another service's database.
2. **Zero Code Dependency:** No service imports another service's internal domain models, controllers, or repositories.
3. **Anti-Corruption Layer (ACL):** Services protect their domain integrity by translating foreign API representations through dedicated adapter interfaces.

```mermaid
graph LR
    subgraph Core Service Context
        CoreModel["Restaurant Entity<br/>(Full Catalog Document)"]
    end

    subgraph Anti-Corruption Layer in Planning Service
        CoreAdapter["CoreApiClient (ACL Adapter)<br/>Translates Foreign REST DTO<br/>to Local Candidate Entity"]
    end

    subgraph Planning Service Context
        PlanModel["ItineraryStop Snapshot<br/>(Name, Lat, Lng, Cost)"]
    end

    CoreModel -->|REST JSON| CoreAdapter
    CoreAdapter -->|Domain Entity Mapping| PlanModel
```

---

## 2. ANTI-CORRUPTION LAYER (ACL) IMPLEMENTATION FOR PLANNING SERVICE

In the current monolith, `ItinerariesService` directly imports `Restaurant` schema, creating dangerous coupling: if the restaurant schema evolves, itinerary calculations break.

In the target microservice architecture, the Planning Service implements an **Anti-Corruption Layer (ACL)**:

### 2.1. Candidate Translation Port & Adapter
```typescript
// apps/planning-service/src/application/ports/restaurant-client.port.ts
export interface RestaurantCandidate {
  id: string;
  name: string;
  lat: number;
  lon: number;
  avgPrice: number;
  mealType: 'starter' | 'main' | 'dessert' | 'cafe';
  rating: number;
  tags: string;
}

export interface IRestaurantClient {
  getCandidates(params: {
    lat: number;
    lon: number;
    radiusKm: number;
    budget: number;
    dietaryRestrictions?: string[];
  }): Promise<RestaurantCandidate[]>;
}
```

### 2.2. Immutable Stop Snapshot Design
Instead of referencing `Restaurant` documents via Mongoose `populate()`, the Planning Service persists immutable value snapshots inside `ItineraryStop`:

```typescript
// apps/planning-service/src/domain/entities/itinerary-stop.entity.ts
export class ItineraryStopSnapshot {
  stop_id: string;
  order_index: number;
  restaurant_id: string;      // Foreign Reference Key
  restaurant_name: string;    // Snapshot at tour generation time
  restaurant_lat: number;     // Snapshot coordinate
  restaurant_lng: number;     // Snapshot coordinate
  meal_type: string;
  arrival_time: string;
  departure_time: string;
  dining_duration_mins: number;
  transit_time_mins: number;
  distance_to_next_km: number;
  estimated_cost: number;
}
```

**Architectural Benefit:** If a restaurant changes its business name, relocates, or shuts down, the user's historical itinerary remains fully legible, geographically valid, and visually coherent.

---

## 3. INTER-SERVICE COMMUNICATION PROTOCOLS

### 3.1. Distributed Tracing via Correlation ID
All incoming gateway requests generate or forward a unique UUID `X-Correlation-Id`:

```
Client Request
      │
      ▼
[API Gateway] ──(Injects X-Correlation-Id: "req_f81d4fae-7dec...")
      │
      ├──> [Planning Service] ──(Propagates X-Correlation-Id)──> [AI Service]
      │
      └──> [Core Service]
```

All log entries across Core, Planning, and AI format output with `[CorrelationId: req_...]` to enable seamless end-to-end distributed transaction tracing.

### 3.2. Internal Service Authentication Protocol
- **Outbound Request:** The calling service injects header:
  `X-Internal-Service-Key: <256-bit-hex-secret>`
- **Inbound Guard:** The receiving service enforces `InternalAuthGuard`:
  Uses constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.

---

## 4. RESILIENCE: CIRCUIT BREAKER & TIMEOUT SPECIFICATION

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CIRCUIT BREAKER STATE TRANSITION                     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│        [CLOSED] ──(3 consecutive timeouts/failures)──> [OPEN]         │
│           ▲                                               │            │
│           │                                      (Cooldown 15s)        │
│           │                                               │            │
│      (2 successes) <── [HALF-OPEN] <──────────────────────┘            │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

1. **State CLOSED:** Normal operation. Requests flow to downstream service (AI or Core).
2. **State OPEN:** Downstream service is failing. Circuit trips open immediately. All subsequent requests divert instantly to fallback heuristics (Greedy route planner / Rating sort) without waiting for HTTP timeouts.
3. **State HALF-OPEN:** After 15 seconds, a single canary probe request is sent. If it succeeds, the circuit closes; if it fails, the circuit resets to OPEN.

