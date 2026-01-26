---
name: deploy
description: Deploys HeatSync to AI Builder Space (ai-builders.space). Reads environment variables from .env and triggers deployment via the AI Builder API.
disable-model-invocation: true
allowed-tools: Bash(curl:*), Read, mcp__ai-builders-coach__get_auth_token
---

# Deploy HeatSync

Deploy this application to AI Builder Space at https://heatsync.ai-builders.space/

## Deployment Configuration

- **Repository**: https://github.com/yeliu84/heatsync
- **Service Name**: heatsync
- **Branch**: main
- **Port**: 8000 (default)

## Required Environment Variables

Read from `.env` in the project root:
- `OPENAI_API_KEY` - OpenAI API key for AI extraction
- `OPENAI_MODEL` - Model to use (e.g., `gpt-5.2`)

## Deployment Steps

1. **Read environment variables** from `.env` file in project root
2. **Get AI Builder token** using `mcp__ai-builders-coach__get_auth_token` with `masked: false`
3. **Deploy** by calling the AI Builder API:

```bash
curl -s -X POST "https://space.ai-builders.com/backend/v1/deployments" \
  -H "Authorization: Bearer <AI_BUILDER_TOKEN>" \
  -H "Content-Type: application/json" \
  --data '{
    "repo_url": "https://github.com/yeliu84/heatsync",
    "service_name": "heatsync",
    "branch": "main",
    "env_vars": {
      "OPENAI_API_KEY": "<from .env>",
      "OPENAI_MODEL": "<from .env>"
    }
  }'
```

4. **Report results** including:
   - Deployment status
   - Public URL: https://heatsync.ai-builders.space/
   - Build logs (if available in `streaming_logs`)
   - Any errors

## Notes

- Deployment takes 5-10 minutes to complete
- The `AI_BUILDER_TOKEN` is automatically injected into the container
- Changes must be committed and pushed to GitHub before deploying
