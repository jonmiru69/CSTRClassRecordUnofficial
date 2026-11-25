# Export fonts

The Word form names the reference's Calibri, Times New Roman and Merriweather faces. PDF embeds portable fonts:

- Carlito Regular, Bold and Italic are metrically compatible with Calibri. Original files: https://github.com/google/fonts/tree/main/ofl/carlito. License: `Carlito-OFL.txt`.
- Merriweather is the reference's school-heading family. Original variable TrueType file: https://github.com/google/fonts/tree/main/ofl/merriweather. License: `Merriweather-OFL.txt`.
- Existing Nimbus Roman faces supply the Times-compatible serif text; see `Nimbus-LICENSE.txt`.

The font assets are retained unmodified. PDF creation retains complete font outlines for reader compatibility. The bundled fontkit/pdf-lib combination can emit subset glyph IDs that omit characters in PDF readers.
