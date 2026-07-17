# ROI Payload Storage

Candidate detection can store cropped ROI image payloads for later browsing, review, and refinement. Storing every candidate makes browsing easier but can use much more disk space.

The storage thresholds decide which candidates receive image payloads:

- **Padding** expands the crop around each candidate ROI.
- **Store payload min area** only stores ROI crops above a minimum foreground area.
- **Store payload min width/height** only stores crops that are large enough in each dimension.
- **Store payload min width + height** is a compact size filter for elongated or irregular ROIs.

ROIs that do not receive payloads can still exist as detections, but they will not have thumbnail image data.
