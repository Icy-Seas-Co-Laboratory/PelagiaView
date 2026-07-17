# Threshold Methods

Thresholding turns a preprocessed grayscale frame into a foreground mask. That mask is the starting point for candidate ROI detection, so the method controls how permissive or selective the candidate stage feels.

## Common choices

- **Manual** uses one fixed intensity cutoff. It is predictable when lighting and preprocessing are stable.
- **Otsu** estimates a cutoff from the image histogram. It works best when foreground and background have distinct intensity groups.
- **Bounded Otsu** uses Otsu but rejects weak or overly large foreground masks with contrast and foreground-fraction limits.
- **Bounded Otsu + Canny** combines intensity thresholding with optional edge evidence. It is often a good default for particle-like objects.
- **Adaptive Mean/Gaussian** computes local thresholds and can help when illumination varies across the frame.
- **Percentile Background** compares pixels against a percentile-based local background estimate.
- **Hysteresis** keeps strong foreground and connected weaker foreground, which can preserve faint edges.
- **Sobel Edges** uses image gradients rather than direct intensity.

## Practical guidance

Start with the default preset, preview the red mask overlay, and adjust the smallest number of parameters needed. If the mask floods the frame, lower foreground fraction or increase contrast. If faint targets disappear, lower contrast or use a more local method.
