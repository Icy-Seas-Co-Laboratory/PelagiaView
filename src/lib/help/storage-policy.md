Storage encoding is a scientific data decision as well as a performance setting. Pelagia applies an explicit two-tier policy to newly stored candidate and refined ROI images.

## Default ROI policy

- **Small ROIs:** Zstandard (lossless)
- **Large ROIs:** JPEG at quality 90
- **Large ROI cutoff:** 50,000 px²
- **Masks:** Zstandard (lossless), independently of the ROI image codec

The size is the padded stored crop’s width × height. Channels, dtype, and compressed byte count do not affect the tier. A 250 × 200 crop is therefore large; a 249 × 200 crop is small.

Changing a project policy affects future writes only. Existing payloads retain their original codec metadata, so a project may legitimately contain multiple formats.

## Choosing the cutoff

A lower cutoff sends more ROIs through the large-image codec and usually reduces storage at the cost of more lossy payloads. A higher cutoff preserves more small ROIs exactly but increases storage and I/O. Select the boundary using representative padded ROI dimensions and validate downstream segmentation, measurements, classification, and browsing behavior.

## Codec guidance

- **Zstandard:** lossless array compression that preserves dtype, shape, channels, and exact values. Recommended for small images and masks.
- **PNG:** lossless and broadly inspectable, but may use more CPU and storage for noisy imagery.
- **JPEG:** compact and widely supported, but lossy. It can alter intensity, fine edges, low-contrast features, and texture.
- **JPEG XL:** efficient quality-controlled compression when supported by the server. Treat quality mode as lossy until validated.
- **JPEG XS:** intended for specialized low-latency workflows. Availability varies by installation.
- **Raw:** exact uncompressed pixels; useful for diagnostics and benchmarks, with the largest storage footprint.

Quality runs from 0 to 100. Pelagia applies ROI quality to lossy ROI codecs that support it. The same number is not directly comparable between codecs.

## Deployment allowlist

Administrators define codecs the installation supports with `image_data_storage.allowed_encodings` in the Pelagia configuration file. Project controls only show codecs allowed by that deployment. The global frame codec and the small, large, and mask ROI defaults must all be included in the allowlist.

Codec permission and runtime availability are distinct: an allowed optional codec can still be unavailable if the installed codec library lacks it. Check the administration status before selecting JPEG XL or JPEG XS.

## Before changing a project

- Validate lossy formats using scientific outputs, not appearance alone.
- Benchmark storage size, encode/decode throughput, and browser latency.
- Keep masks lossless unless the mask semantics and decoder have been deliberately redesigned.
- Record why the policy changed and when it took effect.
