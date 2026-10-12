# Root integration scenarios

Place real component-boundary scenarios here as `tests/integration/<domain-or-boundary>/*.test.mjs`. Use actual local implementations where practical; document any test double and required service. API-only HTTP tests stay under `apps/api/test/`. `api-proxy.test.mjs` verifies the live HTTP proxy boundary without a browser; browser journeys belong in `tests/e2e/`. Run with `npm run test:integration`.
