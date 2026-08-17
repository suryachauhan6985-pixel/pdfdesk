# Module Relationships

This is a heuristic data-flow view based on detected routes, services, and
database usage. Typical flow for a web backend project:

```
Browser
   |
Routes
   |
Controller
   |
Service
   |
Database
```

## Files Grouped by Directory (module boundaries)

### `backend`

| File | Purpose |
| --- | --- |
| backend/Dockerfile | Supporting source file. |
| backend/package.json | Supporting source file. |
| backend/server.js | Defines HTTP route handlers (controller/router layer). |

### `backend/routes`

| File | Purpose |
| --- | --- |
| backend/routes/merge.js | Defines HTTP route handlers (controller/router layer). |
| backend/routes/routes_compress.js | Defines HTTP route handlers (controller/router layer). |
| backend/routes/routes_rotate.js | Defines HTTP route handlers (controller/router layer). |
| backend/routes/split.js | Defines HTTP route handlers (controller/router layer). |

### `frontend/js`

| File | Purpose |
| --- | --- |
| frontend/js/js_compress.js | Defines 6 function(s) implementing supporting logic. |
| frontend/js/js_rotate.js | Defines 5 function(s) implementing supporting logic. |
| frontend/js/main.js | Supporting source file. |
| frontend/js/merge.js | Defines 6 function(s) implementing supporting logic. |
| frontend/js/overlay.js | Defines 6 function(s) implementing supporting logic. |
| frontend/js/split.js | Defines 5 function(s) implementing supporting logic. |


