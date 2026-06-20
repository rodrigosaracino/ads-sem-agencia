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

## Secrets necessários

```
wrangler secret put META_CAPI_TOKEN      # token do Conversions API (Meta Events Manager)
wrangler secret put SLACK_WEBHOOK_URL    # Incoming Webhook do Slack (api.slack.com/apps)
wrangler secret put HOTMART_HOTTOK       # token "Hottok" do webhook da Hotmart
```

## Notificações no Slack

- **Lead (cadastro WhatsApp):** disparado automaticamente sempre que a página envia um
  evento `lead` para `/api/track` — nenhuma configuração extra além do `SLACK_WEBHOOK_URL`.
- **Venda aprovada:** disparado quando a Hotmart envia o webhook de compra. Configure em:
  Painel do Produtor Hotmart → Ferramentas → Webhook → adicionar a URL:
  ```
  https://ads-sem-agencia.rodrigosaracino.com.br/api/hotmart-webhook
  ```
  Marque os eventos **"Compra aprovada"** (PURCHASE_APPROVED) e/ou
  **"Compra completa"** (PURCHASE_COMPLETE). A Hotmart exibe um token (**Hottok**) na
  tela de configuração do webhook — copie esse valor e salve com
  `wrangler secret put HOTMART_HOTTOK`. O Worker rejeita qualquer chamada cujo `hottok`
  não corresponda a esse valor, para evitar notificações falsas.
