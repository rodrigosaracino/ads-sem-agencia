# Worker de Tracking — ads-sem-agencia

Recebe via `POST /api/track` os dados de UTM, `gclid`, `fbclid` e client ID enviados pela
landing page (`index.html`), e grava em um banco D1 (`tracking_events`).

## Pré-requisito

```
wrangler login
```

## Passo a passo (rodar dentro de `cloudflare-worker/`)

1. Criar o banco D1:
   ```
   wrangler d1 create ads_sem_agencia_tracking
   ```
   Copiar o `database_id` retornado e colar em `wrangler.toml` no lugar de
   `REPLACE_AFTER_WRANGLER_D1_CREATE`.

2. Aplicar o schema:
   ```
   wrangler d1 execute ads_sem_agencia_tracking --remote --file=schema.sql
   ```

3. Publicar o Worker:
   ```
   wrangler deploy
   ```

4. Confirmar que a rota `ads-sem-agencia.rodrigosaracino.com.br/api/track` foi associada
   à zona `rodrigosaracino.com.br` no painel da Cloudflare (Workers Routes). O domínio
   precisa estar com o proxy (nuvem laranja) ativado para a rota funcionar.

## Consultar os dados

```
wrangler d1 execute ads_sem_agencia_tracking --remote --command="SELECT * FROM tracking_events ORDER BY created_at DESC LIMIT 50"
```
