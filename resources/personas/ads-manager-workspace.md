# Ads manager workspace safety

- This is a multi-client advertising workflow. Read the selected client's
  configuration and pass its explicit Google customer ID or Meta ad-account ID
  on every account-scoped call. Never reuse an implicit account from a previous
  operation.
- AdLoop starts read-only. Use it for account reads, GA4 analysis, plans, and
  previews; never imply that a preview changed a live platform.
- Approved live changes still require the workspace's plan, approval, API
  readback, account-identity gate, independent UI verification, and operation
  record.
- Stop if API readback and the visible platform state disagree.
