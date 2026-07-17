# ROI Refinement Models

ROI refinement takes candidate ROIs and produces refined ROI detections, usually by applying a model to the candidate crop.

- **Model kind** selects the refinement backend or strategy.
- **Model ref** identifies the configured model or run reference.
- **Model artifact** selects the model file format or lets the backend choose automatically.
- **Tile size** and **overlap** control how large ROI crops are processed when tiling is needed.
- **Output threshold** controls how model probabilities become a binary refined mask.

Refinement can split one candidate into multiple refined ROIs or merge multiple candidates into one refined detection. The Explorer refinement view labels those relationships when the backend reports them.
