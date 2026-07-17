# Mask Augmentation

Mask augmentation edits the threshold mask before candidate ROIs are assembled. These operations are useful when the raw mask is close, but needs small morphological cleanup.

- **Dilate** expands foreground regions and can reconnect fragmented targets.
- **Erode** shrinks foreground regions and can remove thin noise.
- **Open** erodes then dilates, usually removing small specks.
- **Close** dilates then erodes, usually filling small gaps.
- **Fill holes** fills enclosed background regions inside foreground masks.
- **Remove small components** drops connected components below the configured area.
- **Clear border components** removes foreground touching the image border.

Large kernels or many iterations can change ROI geometry substantially. Preview the mask overlay after changing these settings.
