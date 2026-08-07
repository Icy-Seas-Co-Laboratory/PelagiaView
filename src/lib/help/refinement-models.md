# ROI Refinement Models

ROI refinement takes candidate ROIs and produces refined ROI detections. Choose one of two explicit methods:

- **Oracle mask refinement** sends each current ROI crop and candidate mask to Oracle Builder, which owns model loading, preprocessing, batching, and thresholding.
- **Identity** promotes every selected candidate ROI unchanged. It does not call Oracle or perform expansion, residual discovery, or overlap reconciliation. Pelagia may still load a missing ROI crop from its source frame so the refined record has a usable payload.

- **Oracle model** selects a registered model alias. Oracle Builder resolves that alias to a validated artifact and returns immutable model provenance with every result.
- Model input geometry and decision thresholds belong to the Oracle model product so operational runs remain reproducible.
- Frame expansion, residual discovery, reconciliation, and storage remain Pelagia workflow settings.

If Oracle Builder is unavailable, Oracle refinement fails explicitly; Pelagia never silently substitutes identity refinement. Identity must be selected intentionally.

Refinement can split one candidate into multiple refined ROIs or merge multiple candidates into one refined detection. The Explorer refinement view labels those relationships when the backend reports them.
