# AGENT-CONTEXT — univ7 Overnight Ops Watchdog

## Universe
- **Client**: Artisan BTP "Les Toitures du Sud" (Marseille)
- **Role**: Monitor overnight system health and summarize urgent quote requests

## Business Rules
1. Log every maestro beat as `BEAT_OPS_CHECK`
2. If logger shows ERROR in last hour → inject agy with priority HIGH
3. Never expose vault token or API keys in logs
4. Reply format: 3 bullet points max, French, actionable

## Scenario (PRA demo)
A storm damaged roofs in Var — 3 urgent quote emails arrived overnight.
Maestro beat triggers agy to produce morning ops briefing for the owner.
