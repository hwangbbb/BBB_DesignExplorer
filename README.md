# BBB Design Explorer

Browser tool for exploring Colibri / Grasshopper energy simulation results.

| Page | What it does |
|---|---|
| `index.html` | Overview: Plotly parallel coordinates, scatter, distribution, table, image gallery |
| `parametric.html` | **Parametric Explorer**: level sliders, selected run vs baseline, global and local sensitivity |

## Quick start (no install)

1. Download the repository (Code → Download ZIP) and unzip it.
2. Double-click `parametric.html`. It runs offline in Chrome, Edge, Firefox or Safari; it needs no server and no internet.
3. Drag your Colibri `data.csv` onto the page, or click **Load CSV**.
4. Optional: click **Load Images** and select the screenshot files so the `img` column shows in the Selected Run panel.

**Demo data** loads a synthetic study. The page labels it "Demo data" in the top bar; its numbers come from a formula, not from a simulation.

## Parametric Explorer: what students see

- **Parallel coordinates.** Each line is one run. Inputs are on the left and outputs on the right.
  - Drag up or down on any axis to filter. Click the band to remove that filter.
  - Click a line to select that run.
- **Sliders.** There is one slider per input, and it snaps to the tested levels.
  - The **orange** line is the run that matches every slider.
  - **Teal** lines differ from it in exactly one input, so you can see what changing one variable does.
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
