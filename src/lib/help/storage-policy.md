Storage encoding is a scientific data decision as well as a performance setting. The safest default is to preserve exact pixel values until a project has measured the effect of lossy compression on its processing and analysis.

## What these settings change

- **Frame encoding** controls newly stored full-frame image arrays.
- **ROI encoding** controls newly stored candidate and refined ROI image payloads.
- **Frame quality** is used by JPEG and JPEG XL. Pelagia currently does not apply it to JPEG XS, PNG, Zstandard, or Raw.
- A project setting is used when a processing request does not provide a more specific override.
- Changing a default affects future writes. It does not transcode payloads that are already stored.

Stored encoding is recorded with the image payload, so a project may contain data written with more than one format after its policy changes.

## Recommended decision path

- Choose **Zstandard** when exact numeric pixel preservation and reliable round trips are the priority. This is the recommended scientific working format when storage permits it.
- Choose **PNG** when exact pixels and compatibility with ordinary image tooling are both important.
- Choose **JPEG XL** only after validating the selected quality against representative imagery and downstream measurements. It can substantially reduce storage, but Pelagia's quality-controlled mode should be treated as lossy unless an exact round-trip has been demonstrated.
- Choose **JPEG** when broad compatibility or smaller payloads outweigh exact pixel preservation. Validate it carefully around small organisms, fine edges, low-contrast features, and quantitative intensity measurements.
- Choose **JPEG XS** for specialized low-latency workflows only when the server reports it as available. Pelagia does not currently expose a JPEG XS quality control, so treat the installed codec profile as potentially lossy until validated.
- Choose **Raw** mainly for diagnostics, benchmarking, or workflows where encoding overhead must be avoided and storage volume is acceptable.
- Choose ROI **Automatic** when you want Pelagia to use PNG for small ROI arrays and Zstandard for larger ones according to the server's configured byte threshold.

## Format behavior

### Zstandard

- Lossless compression of the original array bytes.
- Preserves dtype, shape, channels, and pixel values using stored metadata.
- Generally a strong balance for reproducible processing, although compression ratio depends on the imagery.
- Stored as an array payload rather than a directly browser-readable image.

### PNG

- Lossless image encoding for supported array shapes and data types.
- Easier to inspect with external image software than Zstandard or Raw.
- Encoding and decoding can cost more CPU than simple array compression.
- File size varies substantially with image texture and noise.

### JPEG

- Lossy compression controlled by the 0–100 frame quality value.
- Usually compact and widely compatible.
- Compression can alter pixel intensity, introduce block or ringing artifacts, soften edges, and remove subtle texture.
- Those changes may affect thresholding, segmentation, morphometrics, classification, or later scientific reanalysis.

### JPEG XL

- Quality-controlled image compression with efficient multithreaded encoding in Pelagia.
- Often offers a better storage-versus-quality tradeoff than conventional JPEG.
- Do not assume a high quality number guarantees scientifically lossless data; verify decoded pixels and downstream results for the installed codec.
- Requires JPEG XL support in the server's `imagecodecs` build.

### JPEG XS

- Designed for low-latency image workflows.
- The current Pelagia implementation uses the installed encoder defaults and ignores the frame quality setting.
- Grayscale arrays may be expanded to three channels for encoding and restored according to stored shape metadata.
- Requires a server build with JPEG XS support, which is not present in every `imagecodecs` distribution.

### Raw

- Stores uncompressed array bytes and preserves exact values.
- Avoids image-compression work but produces the largest payloads and increases storage and I/O pressure.
- Requires stored dtype and shape metadata for decoding.

## Understanding quality

Quality runs from 0 to 100, with higher values generally retaining more visual information and requiring more storage. The same number is not directly comparable across JPEG and JPEG XL.

Quality should be selected using representative frames and ROIs, not visual inspection alone. Compare decoded images with their source arrays and measure effects on the actual downstream workflow, including detection recall, ROI boundaries, classifications, and quantitative intensity features.

## Practical project policies

### Preservation-first

- Frames: Zstandard
- ROIs: Zstandard or Automatic
- Use when future analyses are unknown, pixel values are quantitative, or source data cannot be easily regenerated.

### Interoperability-first

- Frames: PNG
- ROIs: PNG or Automatic
- Use when researchers frequently inspect stored payloads outside Pelagia and lossless image representation is required.

### Throughput and capacity constrained

- Frames: validated JPEG XL or JPEG quality
- ROIs: Automatic, Zstandard, or a separately validated lossy format
- Record the validation dataset, codec availability, chosen quality, and downstream performance before adopting the policy.

## Before changing a project

- Confirm the codec is available on every server or worker that must decode the data.
- Benchmark storage size, encode/decode throughput, and browsing latency with representative images.
- For lossy formats, validate scientific outputs rather than relying only on appearance.
- Record why the policy changed and when it took effect.
- Remember that old and new payloads may retain different encodings within the same project.
