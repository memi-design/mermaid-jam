```mermaid
sequenceDiagram
  participant U as User
  participant A as App
  participant API as Backend
  U->>A: Opens app
  A->>API: Fetch session
  API-->>A: Guest session
  A-->>U: Shows games
```
