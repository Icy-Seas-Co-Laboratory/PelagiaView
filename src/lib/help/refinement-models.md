# ROI Refinement Models

ROI refinement takes candidate ROIs and produces refined ROI detections. Pelagia sends each current ROI crop and candidate mask to Oracle Builder, which owns model loading, preprocessing, tiling, batching, and thresholding.

- **Oracle model** selects a registered model alias. Oracle Builder resolves that alias to a validated artifact and returns immutable model provenance with every result.
- Model input geometry and decision thresholds belong to the Oracle model product so operational runs remain reproducible.
- Frame expansion, residual discovery, reconciliation, and storage remain Pelagia workflow settings.

If Oracle Builder is unavailable, refinement fails explicitly; Pelagia never silently substitutes a different model.

Refinement can split one candidate into multiple refined ROIs or merge multiple candidates into one refined detection. The Explorer refinement view labels those relationships when the backend reports them.
