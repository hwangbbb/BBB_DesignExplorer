# BBB Design Explorer

Browser tool for exploring Colibri / Grasshopper energy simulation results.

`index.html` is the full app. One page, one CSV, top to bottom:

1. **Parametric Explorer**: step sliders and parallel coordinates, the selected run against a baseline, and global and local sensitivity
2. **Scatter plot**, with Color by, colour scheme and highlight lowest/highest; **Distribution** sits beside it
3. **Diminishing returns** within each variable
4. **Data table** and **Design Variants** gallery

The old Plotly parallel coordinates and the old isolated-effects tornado were retired. The explorer's chart and its Global sensitivity replace them.

`parametric.html` is the Parametric Explorer on its own. The single-file email version is built from it.

### Colors and themes

**Color Settings** (the half-filled circle icon, or **Colors** on `parametric.html`) has:
- six preset themes
- page background, header, text and accent colors
- chart line color and opacity
- the explorer's selected-run, one-change and filtered-out line colors

The **Dark / Light** button flips the theme. Your choice is saved in the browser and shared by both pages. Picking a theme resets custom colors to that theme's defaults.

## Share by email (one file)

Send `dist/BBB_Parametric_Explorer.html`. The CSS and JS are inlined in it, so the recipient double-clicks it and it opens in their browser, offline. After changing the source, rebuild it with `python tools/build-standalone.py`.

## Quick start (no install)

1. Download the repository (Code → Download ZIP) and unzip it.
2. Double-click `index.html` (full app; the scatter, distribution and returns charts need internet for Plotly) or `parametric.html` (explorer only). It runs offline in Chrome, Edge, Firefox or Safari; it needs no server and no internet.
3. Drag your Colibri `data.csv` onto the page, or click **Load CSV**.
4. Optional: click **Load Images** and select the screenshot files so the `img` column shows in the Selected Run panel.

**Demo data** loads a synthetic study. The page labels it "Demo data" in the top bar; its numbers come from a formula, not from a simulation.

## Parametric Explorer: what students see

- **Parallel coordinates.** Each line is one run. Inputs are on the left and outputs on the right.
  - Drag up or down on any axis to filter. Click the band to remove that filter.
  - Click a line to select that run.
- **Sliders.** Each input is a row of dots, one per tested value, evenly spaced with its label underneath.
  - Click or drag along the row, or use the arrow keys.
  - The **orange** line is the run that matches every slider. All other runs are drawn faint in one color.
  - **Show one-change runs** adds teal lines for runs that differ from the selection in exactly one input.
- **Selected Run.** Shows the primary output in large type and a table of every output against a baseline.
  - The baseline defaults to the highest-EUI run. **Set as baseline** pins the current run instead.
  - **Copy run values** copies the run as tab-separated text you can paste into Excel.
- **Sensitivity, Global.** Ranks inputs by their average effect on the chosen output across all combinations of the other inputs. Each bar also shows:
  - the best level
  - the direction of the effect
  - the number of groups used
  - a red flag when missing runs left groups incomplete
- **Sensitivity, Local.** Tornado chart around the current slider settings. It answers: from here, which single change moves EUI the most?

## CSV format

- `in:` columns are inputs. Values can be numbers (`20`, `20%`, `0.15`) or text (`Option 1`, `Triple`).
  - Numeric levels are sorted ascending.
  - Text levels keep the order they appear in the file.
- `out:` columns are numeric outputs. Put units in parentheses, for example `out:EUI (kBtu/sf·yr)`; they are shown on every axis and value.
- `img` is optional: a screenshot file name or path for each run.
- Incomplete grids are fine. Combinations with no run show "No run with this combination", and the sensitivity charts report the groups they skipped.

## Tests

```
node tests/parametric.test.js
```

The tests check:
- global impact equals slope × level span on a full grid
- missing runs are reported and never produce NaN
- text-valued inputs work as axes, sliders and sensitivity variables
- a 3,000-run file stays fast
