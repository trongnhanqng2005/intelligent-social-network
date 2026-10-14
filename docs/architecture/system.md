# Current system architecture

## Implemented runtime

The repository contains two npm workspaces. The NestJS API composes validated configuration, an application-scoped Neo4j driver/migration provider, `HealthModule`, `AuthModule`, and `UsersModule`. `/health` is process liveness; `/ready` checks configured database identity and V3 migration/index readiness. The React app owns one `BrowserRouter`, Weylume public/authenticated home states, authentication routes, protected profile/discovery routes, shared API/config boundaries, and not-found handling. The public homepage does not make a health request. Browser authentication uses an HttpOnly session cookie, CSRF/origin defense, and Neo4j-backed session restoration.

```mermaid
flowchart LR
  Browser[Browser: React 19] --> Router[App / BrowserRouter]
  Router --> Home[Weylume public / authenticated home]
  Router --> AuthUI[Login / registration UI]
  AuthUI -->|auth requests| Vite[Vite development proxy]
  Vite -->|strip /api| Nest[NestJS API]
  Nest --> Root[AppModule]
  Root --> Config[ConfigModule + environment validation]
  Root --> HealthModule[HealthModule]
  Root --> AuthModule[AuthModule]
  Root --> UsersModule[UsersModule]
  HealthModule --> Neo4jModule[Neo4jModule: driver + explicit DB sessions]
  AuthModule --> Neo4jModule
  Neo4jModule --> Neo4j[(Configured Neo4j database)]
  HealthModule --> Controller[HealthController: GET /health]
  HealthModule --> Ready[ReadinessController: GET /ready]
  Ready --> Schema[Schema version/readiness service]
  Schema --> Neo4jModule
  AuthModule --> AuthAPI[Auth API: origin + CSRF + session guard]
  AuthAPI -->|/auth/* via development /api proxy| Vite
  AuthModule --> AuthRepo[AuthRepository: managed transactions]
  AuthRepo --> Neo4jModule
  UsersModule --> UsersAPI[Users API: guarded profiles + directory]
  UsersAPI --> AuthModule
  UsersAPI --> UsersRepo[UsersRepository: allowlisted projections + versioned writes]
  UsersRepo --> Neo4jModule
  Router --> ProfileUI[Profile / Discovery UI]
  ProfileUI -->|user requests| Vite
```

This diagram covers implemented foundation, authentication, profile and discovery only; it is not a future-state social/data architecture. Friendship, posts/interactions, recommendations, ETL, ML, production routing and account recovery remain unimplemented. Event retention policy is unresolved and there is no pruning job. Database identity/privilege checks are recorded separately from source implementation and builds.

## Dependency direction

API bootstrap starts `AppModule`; the root module composes feature/configuration modules. Health stays independent of the database; auth and users providers use the app-scoped Neo4j driver through their repositories. On the web, `app/` composes routes, auth owns session state, profile/discovery own their API and screens, and shared code owns base URL/config and presentation primitives. Health/readiness remain operational API contracts, not public homepage content. The web workspace does not import API source.

The application foundation architecture review reported PASS. Details/evidence live in `task/setup-application-foundation/todo.md`; that handoff is historical evidence, not an ongoing implementation specification.
