# ROI Refinement Models

ROI refinement takes candidate ROIs and produces refined ROI detections. Choose a method:

- **Heuristic edge refinement** is the default CPU-only method. It grows from the candidate mask, follows strong oblique boundaries, and deliberately ignores horizontal and vertical line-scan sensor edges. The resolved parameters and edge audit are retained with the refined ROI.
- **Heuristic v2** and **Heuristic v3** are built-in CPU refinement methods available in Explorer and the processing queue. They use the server’s configured version-specific settings and require no Oracle model. The configured method is preserved when loading defaults, and queued-method preferences survive reloads.
- **Oracle mask refinement** sends each current ROI crop and candidate mask to Oracle Builder, which owns model loading, preprocessing, batching, and thresholding.
- **Identity** promotes every selected candidate ROI unchanged. It does not call Oracle or perform expansion, residual discovery, or overlap reconciliation. Pelagia may still load a missing ROI crop from its source frame so the refined record has a usable payload.

- **Oracle model** selects a sealed artifact ID from Oracle Builder's catalog. The picker shows its friendly name; the ID and fingerprint identify the exact model used for inference.
- Model input geometry and decision thresholds belong to the Oracle model product so operational runs remain reproducible.
- Frame expansion, residual discovery, reconciliation, and storage remain Pelagia workflow settings.

If Oracle Builder is unavailable, Oracle refinement fails explicitly; Pelagia never silently substitutes another method. Choose heuristic refinement or identity explicitly when appropriate.

For line-scan assets, queue **line-scan continuity** after refinement completes. It creates an auditable logical assembly across adjacent frames, recording accepted and rejected links, while preserving every frame-local refined ROI and its original raster payload.

Refinement can split one candidate into multiple refined ROIs or merge multiple candidates into one refined detection. The Explorer refinement view labels those relationships when the backend reports them.

Explorer compares refinements on the frame that owns the candidate ROIs. For live previews this is the sandbox frame, not the original source frame. **Refresh persisted results** keeps that sandbox context, including after a queued refinement completes.
