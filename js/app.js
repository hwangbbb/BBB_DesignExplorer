/* ============================================================
   BBB Design Explorer - Main Application
   Energy Simulation Visualization Tool
   ============================================================ */
(function () {
    'use strict';

    // ================================================================
    //  EXPLICIT COLORSCALES (for Plotly parcoords which ignores named ones)
    // ================================================================
    const COLORSCALES = {
        Plasma: [
            [0.0, '#0d0887'], [0.111, '#46039f'], [0.222, '#7201a8'],
            [0.333, '#9c179e'], [0.444, '#bd3786'], [0.556, '#d8576b'],
            [0.667, '#ed7953'], [0.778, '#fb9f3a'], [0.889, '#fdca26'],
            [1.0, '#f0f921']
        ],
        Inferno: [
            [0.0, '#000004'], [0.111, '#1b0c41'], [0.222, '#4a0c4e'],
            [0.333, '#781c6d'], [0.444, '#a52c60'], [0.556, '#cf4446'],
            [0.667, '#ed6925'], [0.778, '#fb9b06'], [0.889, '#f7d13d'],
            [1.0, '#fcffa4']
        ],
        Viridis: [
            [0.0, '#440154'], [0.111, '#482777'], [0.222, '#3e4989'],
            [0.333, '#31688e'], [0.444, '#26828e'], [0.556, '#1f9d89'],
            [0.667, '#35b779'], [0.778, '#6ece58'], [0.889, '#b5de2b'],
            [1.0, '#fde725']
        ],
        Cividis: [
            [0.0, '#00224e'], [0.111, '#123570'], [0.222, '#3b496c'],
            [0.333, '#575d6d'], [0.444, '#707173'], [0.556, '#8a8678'],
            [0.667, '#a59c74'], [0.778, '#c3b369'], [0.889, '#e1cc55'],
            [1.0, '#fee838']
        ]
    };

    /* Return an explicit colorscale array for any named or custom scale */
    function resolveColorscale(scale) {
        if (Array.isArray(scale)) return scale;          // already an array (custom HSB)
        return COLORSCALES[scale] || scale;              // lookup or pass name as-is
    }

    // ================================================================
    //  DATA MANAGER
    // ================================================================
    class DataManager {
        constructor() {
            this.rawData = [];
            this.columns = { inputs: [], outputs: [], images: [] };
            this.allColumns = [];
            this.numericColumns = [];
            this.categoricalColumns = [];
            this.categoryMaps = {};   // col -> { value: index }
            this.images = {};         // filename -> dataURL
            this.filteredIndices = null;
        }

        /* Parse CSV text and build internal structures */
        parseCSV(csvText) {
            const result = Papa.parse(csvText.trim(), {
                header: true,
                skipEmptyRows: true,
                dynamicTyping: false
            });
            this.rawData = result.data;
            this._analyzeColumns(result.meta.fields);
            this._classifyColumns();
            return this;
        }

        _analyzeColumns(fields) {
            this.allColumns = fields.filter(f => f);
            this.columns = { inputs: [], outputs: [], images: [] };
            this.allColumns.forEach(col => {
                const lower = col.toLowerCase().trim();
                if (lower.startsWith('in:')) this.columns.inputs.push(col);
                else if (lower.startsWith('out:')) this.columns.outputs.push(col);
                // Colibri writes the image column as "img:<name>" (e.g. img:Output); older files use "img"
                else if (/^(img|image)(:|$)/.test(lower)) this.columns.images.push(col);
            });
        }

        _classifyColumns() {
            this.numericColumns = [];
            this.categoricalColumns = [];
            this.categoryMaps = {};
            const dataCols = this.dataColumns;

            dataCols.forEach(col => {
                const values = this.rawData.map(r => r[col]).filter(v => v !== '' && v != null);
                const numericValues = values.map(v => {
                    const s = String(v).replace('%', '').trim();
                    return parseFloat(s);
                });
                const allNumeric = numericValues.every(v => !isNaN(v));

                if (allNumeric && values.length > 0) {
                    this.numericColumns.push(col);
                } else {
                    this.categoricalColumns.push(col);
                    const unique = [...new Set(values)];
                    this.categoryMaps[col] = {};
                    unique.forEach((v, i) => { this.categoryMaps[col][String(v)] = i; });
                }
            });
        }

        get dataColumns() {
            return [...this.columns.inputs, ...this.columns.outputs];
        }

        getNumericValue(row, col) {
            const val = row[col];
            if (val == null || val === '') return NaN;
            if (this.categoryMaps[col]) {
                return this.categoryMaps[col][String(val)] ?? NaN;
            }
            return parseFloat(String(val).replace('%', '').trim());
        }

        getColumnValues(col) {
            return this.rawData.map(r => this.getNumericValue(r, col));
        }

        getCategories(col) {
            if (!this.categoryMaps[col]) return null;
            return Object.keys(this.categoryMaps[col]);
        }

        isCategorical(col) {
            return !!this.categoryMaps[col];
        }

        getColumnRange(col) {
            const vals = this.getColumnValues(col).filter(v => !isNaN(v));
            return [Math.min(...vals), Math.max(...vals)];
        }

        // Image names are matched loosely: folder path, letter case and the extension are ignored,
        // so "Run 1.png" in the CSV finds "run 1.PNG" or "...\\images\\Run 1.png".
        _imgKey(name) {
            return String(name || '').trim().split(/[\\/]/).pop().toLowerCase().replace(/\.(png|jpe?g|gif|webp|bmp)$/, '');
        }

        addImage(filename, url) {
            const key = this._imgKey(filename);
            if (this.images[key] && this.images[key].startsWith('blob:')) URL.revokeObjectURL(this.images[key]);
            this.images[key] = url;
        }

        getImageUrl(row) {
            if (this.columns.images.length === 0) return null;
            const imgCol = this.columns.images[0];
            return this.images[this._imgKey(row[imgCol])] || null;
        }

        get rowCount() { return this.rawData.length; }
    }

    // ================================================================
    //  CHART RENDERERS
    // ================================================================

    function renderParallelCoords(dm, containerId, options) {
        const dataCols = dm.dataColumns;
        if (dataCols.length === 0) return;

        const showText = options.showText !== false; // default: show labels

        // Helper: generate clean, evenly-spaced tick values using "nice numbers"
        function niceNum(range, round) {
            if (range === 0) return 1;
            const exponent = Math.floor(Math.log10(range));
            const fraction = range / Math.pow(10, exponent);
            let nice;
            if (round) {
                if (fraction < 1.5) nice = 1;
                else if (fraction < 3) nice = 2;
                else if (fraction < 7) nice = 5;
                else nice = 10;
            } else {
                if (fraction <= 1) nice = 1;
                else if (fraction <= 2) nice = 2;
                else if (fraction <= 5) nice = 5;
                else nice = 10;
            }
            return nice * Math.pow(10, exponent);
        }

        function generateNiceTicks(min, max, maxTicks) {
            maxTicks = maxTicks || 6;
            const range = max - min;
            if (range === 0) return [min];

            // Try increasing step sizes until tick count is within maxTicks
            let step = niceNum(range / (maxTicks - 1), true);
            let niceMin, niceMax, count;
            for (let attempt = 0; attempt < 5; attempt++) {
                niceMin = Math.floor(min / step) * step;
                niceMax = Math.ceil(max / step) * step;
                count = Math.round((niceMax - niceMin) / step) + 1;
                if (count <= maxTicks) break;
                // Step up to next nice number
                step = niceNum(step * 1.5, false);
            }

            const ticks = [];
            for (let v = niceMin; v <= niceMax + step * 0.001; v += step) {
                ticks.push(parseFloat(v.toFixed(10)));
            }
            return ticks;
        }

        // Helper: Find common prefix for categorical strings to avoid repetitive labels
        function getCommonPrefix(strings) {
            if (!strings || strings.length === 0) return '';
            let prefix = strings[0];
            for (let i = 1; i < strings.length; i++) {
                while (strings[i].indexOf(prefix) !== 0) {
                    prefix = prefix.substring(0, prefix.length - 1);
                    if (prefix === '') return '';
                }
            }

            if (prefix.length > 3) {
                // If the prefix doesn't end nicely on a delimiter, crop it back to the last delimiter
                if (!prefix.match(/[-_ \:]$/)) {
                    const lastDelim = Math.max(prefix.lastIndexOf('-'), prefix.lastIndexOf('_'), prefix.lastIndexOf(' '), prefix.lastIndexOf(':'));
                    if (lastDelim > 0) {
                        prefix = prefix.substring(0, lastDelim + 1);
                    } else {
                        return '';
                    }
                }
                return prefix;
            }
            return '';
        }

        const dimensions = dataCols.map(col => {
            const values = dm.getColumnValues(col);
            const cats = dm.getCategories(col);

            if (cats) {
                const catValues = dm.rawData.map(row => cats.indexOf(row[col]));
                const prefix = getCommonPrefix(cats);

                return {
                    label: showText ? (options.customLabels && options.customLabels[col] ? options.customLabels[col] : cleanLabel(col)) : '',
                    values: catValues,
                    tickvals: cats.map((_, i) => i),
                    ticktext: showText ? cats.map(c => {
                        const custom = options.customTickLabels && options.customTickLabels[col] && options.customTickLabels[col][c];
                        if (custom) return truncate(custom, 18);
                        let cleanName = c;
                        if (prefix) cleanName = cleanName.substring(prefix.length);
                        return truncate(cleanName, 18);
                    }) : cats.map(() => ''),
                    range: [0, cats.length - 1]
                };
            } else {
                const validVals = values.filter(v => !isNaN(v));
                const mn = Math.min(...validVals);
                const mx = Math.max(...validVals);

                // Always generate nice evenly-spaced ticks within [mn, mx]
                // (matches Thornton Tomasetti Design Explorer approach)
                const tickVals = generateNiceTicks(mn, mx, 6);
                const allInt = tickVals.every(v => Number.isInteger(v));
                const tickText = tickVals.map(v => allInt ? String(Math.round(v)) : String(v));

                // Range = tick bounds so first/last tick sit at axis endpoints (all axes equal length)
                return {
                    label: showText ? (options.customLabels && options.customLabels[col] ? options.customLabels[col] : cleanLabel(col)) : '',
                    values: values,
                    tickvals: showText ? tickVals : [],
                    ticktext: showText ? tickText : [],
                    range: [tickVals[0], tickVals[tickVals.length - 1]]
                };
            }
        });

        const colorCol = options.colorDimension || dm.columns.outputs[0] || dataCols[0];
        const originalColors = dm.getColumnValues(colorCol);
        const validColorVals = originalColors.filter(v => !isNaN(v));
        const cmin = Math.min(...validColorVals);
        const cmax = Math.max(...validColorVals);

        const labelSize = options.labelSize || 12;
        const labelColor = options.labelColor || '';  // empty = use theme default

        const trace = {
            type: 'parcoords',
            line: {
                color: originalColors.slice(),
                colorscale: resolveColorscale(options.colorScale || 'Viridis'),
                showscale: false,   // no colorbar legend
                cmin: cmin,
                cmax: cmax
            },
            unselected: {
                line: {
                    opacity: 0
                }
            },
            dimensions: dimensions,
            labelangle: 0,          // horizontal labels, no rotation
            labelside: 'top',
            labelfont: {
                family: options.fontFamily || 'Inter, sans-serif', size: labelSize,
                color: labelColor || undefined
            },
            tickfont: {
                family: options.fontFamily || 'Inter, sans-serif',
                size: showText ? Math.max(8, labelSize - 1) : 0,
                color: labelColor || undefined
            },
            rangefont: {
                color: 'rgba(0,0,0,0)', // Force transparency to hide top and bottom threshold ranges
                size: showText ? 1 : 0  // Set to 0 when text is hidden to fully suppress range labels
            }
        };

        const isDark = document.body.classList.contains('theme-dark') ||
            document.body.classList.contains('theme-ocean') ||
            document.body.classList.contains('theme-forest') ||
            document.body.classList.contains('theme-sunset');
        const plotBg = 'rgba(0,0,0,0)';
        const fontColor = isDark ? '#f2f2f2' : '#0e0e0e';

        const layout = {
            margin: { t: 80, b: 30, l: 60, r: 60 },
            font: { family: options.fontFamily || 'Inter, sans-serif', size: labelSize + 2 || 14, color: fontColor },
            paper_bgcolor: plotBg,
            plot_bgcolor: plotBg
        };

        Plotly.purge(containerId);
        Plotly.newPlot(containerId, [trace], layout, {
            responsive: true,
            displayModeBar: true,
            modeBarButtonsToRemove: ['toImage'],
            displaylogo: false
        }).then(() => {
            // Post-render: hide/show all parcoords text (ticks, extents, titles)
            // Plotly parcoords ignores tickvals:[] and tickfont.size:0,
            // so we must manipulate the SVG elements directly after render.
            const el = document.getElementById(containerId);
            if (el) {
                const vis = showText ? '' : 'none';
                el.querySelectorAll('.axis-extent-text').forEach(t => { t.style.display = vis; });
                el.querySelectorAll('.tick text').forEach(t => { t.style.display = vis; });
                el.querySelectorAll('.axis-title').forEach(t => { t.style.display = vis; });
            }
        });
    }

    function renderScatterPlot(dm, containerId, options) {
        const xCol = options.xAxis;
        const yCol = options.yAxis;
        if (!xCol || !yCol) return;

        const xValues = dm.getColumnValues(xCol);
        const yValues = dm.getColumnValues(yCol);

        const colorCol = options.colorDimension;
        const colorValues = colorCol ? dm.getColumnValues(colorCol) : null;

        const sizeCol = options.sizeDimension;
        let sizeValues = null;
        if (sizeCol) {
            const raw = dm.getColumnValues(sizeCol);
            const valid = raw.filter(v => !isNaN(v));
            const mn = Math.min(...valid);
            const mx = Math.max(...valid);
            const range = mx - mn || 1;
            sizeValues = raw.map(v => isNaN(v) ? 8 : 6 + ((v - mn) / range) * 20);
        }

        const markerSize = parseInt(
            document.getElementById('marker-size')?.value || '10'
        );

        const hoverText = dm.rawData.map((r, i) => {
            const parts = [`<b>Design #${i + 1}</b>`];
            dm.dataColumns.forEach(c => {
                parts.push(`${cleanLabel(c)}: ${r[c]}`);
            });
            return parts.join('<br>');
        });

        const trace = {
            x: xValues,
            y: yValues,
            mode: 'markers',
            type: 'scatter',
            marker: {
                size: sizeValues || markerSize,
                color: colorValues || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
                colorscale: options.colorScale || 'Viridis',
                showscale: !!colorValues,
                colorbar: colorValues ? {
                    title: { text: cleanLabel(colorCol) },
                    thickness: 12
                } : undefined,
                opacity: 0.85,
                line: { width: 1, color: 'rgba(0,0,0,0.15)' }
            },
            text: hoverText,
            hovertemplate: '%{text}<extra></extra>'
        };

        const isDark = document.body.classList.contains('theme-dark') ||
            document.body.classList.contains('theme-ocean') ||
            document.body.classList.contains('theme-forest') ||
            document.body.classList.contains('theme-sunset');
        const fontColor = isDark ? '#f2f2f2' : '#0e0e0e';
        const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';

        // Build axis config with categorical tick labels when needed
        const xCats = dm.getCategories(xCol);
        const yCats = dm.getCategories(yCol);

        const xaxisCfg = {
            title: { text: cleanLabel(xCol) },
            gridcolor: gridColor,
            zerolinecolor: gridColor
        };
        if (xCats) {
            xaxisCfg.tickmode = 'array';
            xaxisCfg.tickvals = xCats.map((_, i) => i);
            xaxisCfg.ticktext = xCats;
        }

        const yaxisCfg = {
            title: { text: cleanLabel(yCol) },
            gridcolor: gridColor,
            zerolinecolor: gridColor
        };
        if (yCats) {
            yaxisCfg.tickmode = 'array';
            yaxisCfg.tickvals = yCats.map((_, i) => i);
            yaxisCfg.ticktext = yCats;
        }

        const layout = {
            xaxis: xaxisCfg,
            yaxis: yaxisCfg,
            margin: { t: 20, b: 50, l: 60, r: 20 },
            font: { family: 'Inter, sans-serif', size: 12, color: fontColor },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            hovermode: 'closest'
        };

        Plotly.purge(containerId);
        Plotly.newPlot(containerId, [trace], layout, {
            responsive: true,
            displayModeBar: true,
            modeBarButtonsToRemove: ['toImage', 'lasso2d'],
            displaylogo: false
        });
    }

    function renderHistogram(dm, containerId, options) {
        const col = options.variable;
        if (!col) return;

        const values = dm.getColumnValues(col);
        const cats = dm.getCategories(col);
        const colorScale = options.colorScale || 'Viridis';

        const isDark = document.body.classList.contains('theme-dark') ||
            document.body.classList.contains('theme-ocean') ||
            document.body.classList.contains('theme-forest') ||
            document.body.classList.contains('theme-sunset');
        const fontColor = isDark ? '#f2f2f2' : '#0e0e0e';
        const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';

        let trace, layout;

        if (cats) {
            // Bar chart for categorical - color each bar by index using colorscale
            const counts = {};
            dm.rawData.forEach(r => {
                const v = String(r[col]);
                counts[v] = (counts[v] || 0) + 1;
            });
            const keys = Object.keys(counts);
            const vals = Object.values(counts);
            const barColors = keys.map((_, i) => i / (keys.length - 1 || 1));
            trace = {
                x: keys,
                y: vals,
                type: 'bar',
                marker: {
                    color: barColors,
                    colorscale: colorScale,
                    opacity: 0.9
                }
            };
        } else {
            // Histogram - compute bins manually to color each bar
            const filtered = values.filter(v => !isNaN(v));
            const nbins = Math.min(20, Math.ceil(Math.sqrt(filtered.length)));
            const mn = Math.min(...filtered);
            const mx = Math.max(...filtered);
            const binWidth = (mx - mn) / nbins || 1;
            const bins = new Array(nbins).fill(0);
            const binCenters = [];
            for (let i = 0; i < nbins; i++) {
                binCenters.push(mn + (i + 0.5) * binWidth);
            }
            filtered.forEach(v => {
                let idx = Math.floor((v - mn) / binWidth);
                if (idx >= nbins) idx = nbins - 1;
                if (idx < 0) idx = 0;
                bins[idx]++;
            });
            const barColors = binCenters.map((_, i) => i / (nbins - 1 || 1));
            trace = {
                x: binCenters,
                y: bins,
                type: 'bar',
                width: binWidth * 0.9,
                marker: {
                    color: barColors,
                    colorscale: colorScale,
                    opacity: 0.9
                }
            };
        }

        layout = {
            xaxis: {
                title: { text: cleanLabel(col) },
                gridcolor: gridColor
            },
            yaxis: {
                title: { text: 'Count' },
                gridcolor: gridColor
            },
            margin: { t: 20, b: 50, l: 50, r: 20 },
            font: { family: 'Inter, sans-serif', size: 12, color: fontColor },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            bargap: 0.1
        };

        Plotly.purge(containerId);
        Plotly.newPlot(containerId, [trace], layout, {
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['toImage']
        });
    }

    function renderDataTable(dm, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const cols = dm.dataColumns;
        let html = '<table><thead><tr>';
        html += '<th>#</th>';
        cols.forEach(col => {
            html += `<th data-col="${col}">${cleanLabel(col)} <span class="sort-arrow">&#9650;</span></th>`;
        });
        html += '</tr></thead><tbody>';

        dm.rawData.forEach((row, i) => {
            html += `<tr data-index="${i}">`;
            html += `<td>${i + 1}</td>`;
            cols.forEach(col => {
                const val = row[col];
                html += `<td>${val != null ? val : ''}</td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;

        // Sortable headers
        container.querySelectorAll('th[data-col]').forEach(th => {
            let ascending = true;
            th.addEventListener('click', () => {
                const col = th.dataset.col;
                const tbody = container.querySelector('tbody');
                const rows = Array.from(tbody.querySelectorAll('tr'));

                rows.sort((a, b) => {
                    const ai = parseInt(a.dataset.index);
                    const bi = parseInt(b.dataset.index);
                    const va = dm.getNumericValue(dm.rawData[ai], col);
                    const vb = dm.getNumericValue(dm.rawData[bi], col);
                    if (isNaN(va) && isNaN(vb)) return 0;
                    if (isNaN(va)) return 1;
                    if (isNaN(vb)) return -1;
                    return ascending ? va - vb : vb - va;
                });

                rows.forEach(r => tbody.appendChild(r));

                // Update UI
                container.querySelectorAll('th').forEach(t => t.classList.remove('sorted'));
                th.classList.add('sorted');
                th.querySelector('.sort-arrow').innerHTML = ascending ? '&#9660;' : '&#9650;';
                ascending = !ascending;
            });
        });
    }

    function renderImageGallery(dm, containerId, options) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const imgCol = dm.columns.images[0];
        if (!imgCol && Object.keys(dm.images).length === 0) {
            container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">No images loaded. Use "Load Images" to upload PNG files.</div>';
            return;
        }

        // Build sorted indices
        let indices = dm.rawData.map((_, i) => i);
        if (options.sortBy) {
            indices.sort((a, b) => {
                const va = dm.getNumericValue(dm.rawData[a], options.sortBy);
                const vb = dm.getNumericValue(dm.rawData[b], options.sortBy);
                if (isNaN(va) && isNaN(vb)) return 0;
                if (isNaN(va)) return 1;
                if (isNaN(vb)) return -1;
                return options.sortOrder === 'desc' ? vb - va : va - vb;
            });
        }

        container.innerHTML = '';
        const seen = new Set();

        indices.forEach(i => {
            const row = dm.rawData[i];
            const imgFile = imgCol ? row[imgCol] : null;
            const imgUrl = dm.getImageUrl(row);

            // Skip duplicate images showing same data
            const key = imgFile + '_' + i;
            if (seen.has(key)) return;
            seen.add(key);

            const card = document.createElement('div');
            card.className = 'gallery-card';
            card.dataset.index = i;

            // Image or placeholder
            if (imgUrl) {
                card.innerHTML = `<div class="gallery-card-img"><img src="${imgUrl}" alt="Design #${i + 1}"></div>`;
            } else {
                card.innerHTML = `<div class="gallery-card-placeholder">${imgFile || 'No image'}</div>`;
            }

            // Info
            const info = document.createElement('div');
            info.className = 'gallery-card-info';
            const parts = [`<strong>#${i + 1}</strong>`];
            dm.columns.inputs.slice(0, 2).forEach(c => {
                parts.push(`${cleanLabel(c)}: ${row[c]}`);
            });
            dm.columns.outputs.slice(0, 1).forEach(c => {
                parts.push(`${cleanLabel(c)}: ${row[c]}`);
            });
            info.innerHTML = parts.join(' | ');
            card.appendChild(info);

            // Click for lightbox
            card.addEventListener('click', () => openLightbox(dm, i));
            container.appendChild(card);
        });
    }

    // ================================================================
    //  LIGHTBOX
    // ================================================================

    function openLightbox(dm, rowIndex) {
        const row = dm.rawData[rowIndex];
        const imgUrl = dm.getImageUrl(row);
        const lightbox = document.getElementById('lightbox');
        const img = document.getElementById('lightbox-img');
        const info = document.getElementById('lightbox-info');

        if (imgUrl) {
            img.src = imgUrl;
            img.style.display = 'block';
        } else {
            img.style.display = 'none';
        }

        const parts = [`<strong>Design #${rowIndex + 1}</strong><br>`];
        dm.dataColumns.forEach(c => {
            const label = cleanLabel(c);
            parts.push(`${label}: <strong>${row[c]}</strong>`);
        });
        info.innerHTML = parts.join(' &nbsp;|&nbsp; ');

        lightbox.classList.remove('hidden');
    }

    function closeLightbox() {
        document.getElementById('lightbox').classList.add('hidden');
    }

    // ================================================================
    //  CHART EXPORT
    // ================================================================

    function getExportSettings(el) {
        const inputW = document.getElementById('export-width')?.value;
        const inputH = document.getElementById('export-height')?.value;
        return {
            format: document.getElementById('export-format')?.value || 'png',
            scale: parseInt(document.getElementById('export-scale')?.value || '4'),
            width: inputW ? parseInt(inputW) : (el ? el.clientWidth : 1920),
            height: inputH ? parseInt(inputH) : (el ? el.clientHeight : 1080),
            bg: document.getElementById('export-bg')?.value || 'white'
        };
    }

    function exportChart(chartId, filename) {
        const el = document.getElementById(chartId);
        if (!el || !el.data) return;

        const settings = getExportSettings(el);
        const bgColor = settings.bg === 'transparent' ? 'rgba(0,0,0,0)' : '#ffffff';

        // Temporarily set background for export, then restore
        Plotly.relayout(chartId, { paper_bgcolor: bgColor, plot_bgcolor: bgColor })
            .then(function () {
                return Plotly.downloadImage(el, {
                    format: settings.format,
                    width: settings.width,
                    height: settings.height,
                    scale: settings.scale,
                    filename: filename || chartId + '_export'
                });
            })
            .then(function () {
                Plotly.relayout(chartId, {
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)'
                });
            });
    }

    function exportAllCharts() {
        const charts = [
            { id: 'parcords-chart', name: 'parallel_coordinates' },
            { id: 'scatter-chart', name: 'scatter_plot' },
            { id: 'histogram-chart', name: 'distribution' }
        ];
        let delay = 0;
        charts.forEach(c => {
            const el = document.getElementById(c.id);
            if (el && el.data) {
                setTimeout(() => exportChart(c.id, c.name), delay);
                delay += 800; // stagger downloads
            }
        });
    }

    // ================================================================
    //  HSB COLOR UTILITIES
    // ================================================================

    function hsbToRgb(h, s, b) {
        // h: 0-360, s: 0-100, b: 0-100 -> [r,g,b] 0-255
        s /= 100; b /= 100;
        const c = b * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = b - c;
        let r, g, bl;
        if (h < 60) { r = c; g = x; bl = 0; }
        else if (h < 120) { r = x; g = c; bl = 0; }
        else if (h < 180) { r = 0; g = c; bl = x; }
        else if (h < 240) { r = 0; g = x; bl = c; }
        else if (h < 300) { r = x; g = 0; bl = c; }
        else { r = c; g = 0; bl = x; }
        return [
            Math.round((r + m) * 255),
            Math.round((g + m) * 255),
            Math.round((bl + m) * 255)
        ];
    }

    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }

    function buildCustomColorscale(startHSB, endHSB, steps) {
        steps = steps || 8;
        const scale = [];
        for (let i = 0; i < steps; i++) {
            const t = i / (steps - 1);
            const h = startHSB.h + t * (endHSB.h - startHSB.h);
            const s = startHSB.s + t * (endHSB.s - startHSB.s);
            const b = startHSB.b + t * (endHSB.b - startHSB.b);
            const [r, g, bl] = hsbToRgb(h, s, b);
            scale.push([t, `rgb(${r},${g},${bl})`]);
        }
        return scale;
    }

    function getHSBFromSliders(prefix) {
        return {
            h: parseInt(document.getElementById(`hsb-${prefix}-h`)?.value || '0'),
            s: parseInt(document.getElementById(`hsb-${prefix}-s`)?.value || '80'),
            b: parseInt(document.getElementById(`hsb-${prefix}-b`)?.value || '90')
        };
    }

    function updateHSBPreview() {
        const start = getHSBFromSliders('start');
        const end = getHSBFromSliders('end');

        // Update value labels
        ['start', 'end'].forEach(prefix => {
            ['h', 's', 'b'].forEach(ch => {
                const val = document.getElementById(`hsb-${prefix}-${ch}`)?.value || '0';
                const label = document.getElementById(`hsb-${prefix}-${ch}-val`);
                if (label) label.textContent = val;
            });
        });

        // Swatches
        const [sr, sg, sb] = hsbToRgb(start.h, start.s, start.b);
        const [er, eg, eb] = hsbToRgb(end.h, end.s, end.b);
        const startSwatch = document.getElementById('hsb-start-swatch');
        const endSwatch = document.getElementById('hsb-end-swatch');
        if (startSwatch) startSwatch.style.background = `rgb(${sr},${sg},${sb})`;
        if (endSwatch) endSwatch.style.background = `rgb(${er},${eg},${eb})`;

        // Gradient preview
        const preview = document.getElementById('hsb-gradient-preview');
        if (preview) {
            const stops = [];
            for (let i = 0; i <= 8; i++) {
                const t = i / 8;
                const h = start.h + t * (end.h - start.h);
                const s = start.s + t * (end.s - start.s);
                const b = start.b + t * (end.b - start.b);
                const [r, g, bl] = hsbToRgb(h, s, b);
                stops.push(`rgb(${r},${g},${bl})`);
            }
            preview.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
        }
    }

    // ================================================================
    //  HELPERS
    // ================================================================

    function cleanLabel(col) {
        return col.replace(/^(in|out):/i, '').trim();
    }

    function truncate(str, maxLen) {
        return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
    }

    // ================================================================
    //  MAIN APP
    // ================================================================

    class App {
        constructor() {
            this.dm = new DataManager();
            this.titlesVisible = true;
            this.colorPanelOpen = false;
            this.labelPanelOpen = false;
            this.customLabels = {};
            this.customTickLabels = {};
            this.settings = {
                colorScale: 'Viridis',
                colorDimension: null,
                scatterX: null,
                scatterY: null,
                scatterSize: null,
                histogramVar: null,
                gallerySortBy: null,
                gallerySortOrder: 'asc',
                parcoordsTextVisible: true,
                parcoordsLabelSize: 12,
                parcoordsLabelColor: '',
                parcoordsFontFamily: 'Inter, sans-serif'
            };
            this._init();
        }

        _init() {
            this._setupFileUpload();
            this._setupDragDrop();
            this._setupControls();
            this._setupEditableTitles();
            this._setupColorPanel();
            this._setupLabelSettings();
            this._setupLightbox();
            this._setupSampleData();
            this._setupExport();
        }

        // ---- File Upload ----
        _setupFileUpload() {
            const csvInput = document.getElementById('csv-upload');
            const imgInput = document.getElementById('img-upload');

            csvInput.addEventListener('change', (e) => {
                if (e.target.files[0]) this._loadCSVFile(e.target.files[0]);
            });

            imgInput.addEventListener('change', (e) => {
                this._loadImageFiles([...e.target.files]);
                e.target.value = '';   // allow picking the same files again
            });
        }

        _setupDragDrop() {
            const zone = document.getElementById('upload-zone');
            const body = document.body;

            ['dragenter', 'dragover'].forEach(evt => {
                body.addEventListener(evt, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (zone) zone.classList.add('dragover');
                });
            });
            ['dragleave', 'drop'].forEach(evt => {
                body.addEventListener(evt, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (zone) zone.classList.remove('dragover');
                });
            });
            body.addEventListener('drop', (e) => {
                const files = e.dataTransfer.files;
                if (!files.length) return;

                const csvFiles = [];
                const imgFiles = [];
                for (let f of files) {
                    if (f.name.toLowerCase().endsWith('.csv')) csvFiles.push(f);
                    else if (f.type.startsWith('image/')) imgFiles.push(f);
                }
                if (csvFiles.length > 0) this._loadCSVFile(csvFiles[0]);
                if (imgFiles.length > 0) this._loadImageFiles(imgFiles);
            });

            // Click on upload zone also triggers CSV upload
            if (zone) {
                zone.querySelector('.upload-zone-inner').addEventListener('click', (e) => {
                    if (e.target.closest('.btn')) return;
                    document.getElementById('csv-upload').click();
                });
            }
        }

        _loadCSVFile(file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.dm.parseCSV(e.target.result);
                this._onDataLoaded();
            };
            reader.readAsText(file);
        }

        _loadCSVText(text) {
            this.dm.parseCSV(text);
            this._onDataLoaded();
        }

        _loadImageFiles(files) {
            // Object URLs are instant and light, unlike base64 data URLs for hundreds of PNGs.
            const imgs = [...files].filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name));
            if (!imgs.length) return;
            imgs.forEach(f => this.dm.addImage(f.name, URL.createObjectURL(f)));
            this._renderGallery();
            if (this.dm.columns.images.length && this.dm.rowCount) {
                const matched = this.dm.rawData.filter(r => this.dm.getImageUrl(r)).length;
                if (matched === 0) console.warn('Design Explorer: none of the ' + imgs.length + ' images match the "' +
                    this.dm.columns.images[0] + '" column. Check that the file names match the CSV.');
            }
        }

        // ---- Sample Data ----
        _setupSampleData() {
            const btnSample = document.getElementById('btn-load-sample');
            const btnSampleAlt = document.getElementById('btn-load-sample-alt');

            const loadSample = () => {
                // Try to fetch from server first, then use embedded data
                fetch('input_sample/testdata.csv')
                    .then(r => {
                        if (!r.ok) throw new Error('not served');
                        return r.text();
                    })
                    .then(text => this._loadCSVText(text))
                    .catch(() => {
                        // Fallback: use embedded sample
                        this._loadCSVText(SAMPLE_CSV);
                    });
            };

            if (btnSample) btnSample.addEventListener('click', loadSample);
            if (btnSampleAlt) btnSampleAlt.addEventListener('click', loadSample);
        }

        // ---- Export ----
        _setupExport() {
            // Toggle export dropdown
            const btnExportAll = document.getElementById('btn-export-all');
            const dropdown = document.getElementById('export-dropdown');
            if (btnExportAll && dropdown) {
                btnExportAll.addEventListener('click', (e) => {
                    e.stopPropagation();
                    dropdown.classList.toggle('hidden');
                });
                document.addEventListener('click', (e) => {
                    if (!dropdown.contains(e.target) && e.target !== btnExportAll) {
                        dropdown.classList.add('hidden');
                    }
                });
            }

            // Dropdown export buttons
            on('btn-export-parcords', 'click', () => exportChart('parcords-chart', 'parallel_coordinates'));
            on('btn-export-scatter', 'click', () => exportChart('scatter-chart', 'scatter_plot'));
            on('btn-export-histogram', 'click', () => exportChart('histogram-chart', 'distribution'));
            on('btn-export-all-charts', 'click', () => exportAllCharts());

            // Inline export buttons on each chart section
            document.querySelectorAll('.btn-export-chart').forEach(btn => {
                btn.addEventListener('click', () => {
                    const chartId = btn.dataset.chart;
                    const name = chartId.replace('-chart', '').replace('parcords', 'parallel_coordinates');
                    exportChart(chartId, name);
                });
            });
        }

        // ---- Data Loaded ----
        _onDataLoaded() {
            // Show viz, hide upload zone
            document.getElementById('upload-zone').classList.add('hidden');
            document.getElementById('viz-container').classList.remove('hidden');

            // Populate dropdowns
            this._populateSelectors();

            // Set defaults
            const dm = this.dm;
            const numerics = dm.numericColumns;
            const dataCols = dm.dataColumns;

            // Always color by the last output
            this.settings.colorDimension = dm.columns.outputs[dm.columns.outputs.length - 1] || dataCols[dataCols.length - 1];
            this.settings.scatterX = dataCols[0] || null;
            this.settings.scatterY = dm.columns.outputs[0] || dataCols[1] || null;
            this.settings.histogramVar = dm.columns.outputs[0] || dataCols[0];

            // Sync selectors
            setSelectValue('scatter-x', this.settings.scatterX);
            setSelectValue('scatter-y', this.settings.scatterY);
            setSelectValue('histogram-var', this.settings.histogramVar);

            // Update data count
            document.getElementById('data-count').textContent = `${dm.rowCount} designs`;

            // Render all
            this._renderAll();
        }

        _populateSelectors() {
            const dm = this.dm;
            const dataCols = dm.dataColumns;

            const selectors = [
                'scatter-x', 'scatter-y',
                'scatter-size', 'histogram-var', 'gallery-sort'
            ];

            selectors.forEach(id => {
                const sel = document.getElementById(id);
                if (!sel) return;

                // Keep first option if it's a "None" placeholder
                const hasNone = sel.options.length > 0 && sel.options[0].value === '';
                sel.innerHTML = '';
                if (hasNone || id === 'scatter-size' || id === 'gallery-sort') {
                    const opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = 'None';
                    sel.appendChild(opt);
                }

                dataCols.forEach(col => {
                    const opt = document.createElement('option');
                    opt.value = col;
                    opt.textContent = cleanLabel(col);
                    sel.appendChild(opt);
                });
            });
        }

        // ---- Controls ----
        _setupControls() {
            // Color scheme
            on('color-scheme', 'change', (e) => {
                const val = e.target.value;
                if (val === 'custom') {
                    // Re-apply the current HSB gradient
                    const start = getHSBFromSliders('start');
                    const end = getHSBFromSliders('end');
                    this.settings.colorScale = buildCustomColorscale(start, end, 10);
                } else {
                    this.settings.colorScale = val;
                }
                this._renderParallelCoords();
                this._renderScatter();
                this._renderHistogram();
            });

            // Scatter axes
            on('scatter-x', 'change', (e) => {
                this.settings.scatterX = e.target.value;
                this._renderScatter();
            });
            on('scatter-y', 'change', (e) => {
                this.settings.scatterY = e.target.value;
                this._renderScatter();
            });
            on('scatter-size', 'change', (e) => {
                this.settings.scatterSize = e.target.value || null;
                this._renderScatter();
            });

            // Histogram variable
            on('histogram-var', 'change', (e) => {
                this.settings.histogramVar = e.target.value;
                this._renderHistogram();
            });

            // Gallery sort
            on('gallery-sort', 'change', (e) => {
                this.settings.gallerySortBy = e.target.value || null;
                this._renderGallery();
            });
            on('gallery-order', 'change', (e) => {
                this.settings.gallerySortOrder = e.target.value;
                this._renderGallery();
            });

            // Toggle section titles (header text)
            document.getElementById('btn-toggle-titles').addEventListener('click', () => {
                this.titlesVisible = !this.titlesVisible;
                document.querySelectorAll('.section-title').forEach(el => {
                    el.classList.toggle('titles-hidden', !this.titlesVisible);
                });
            });

            // Toggle parcoords axis labels
            on('btn-toggle-parcords-text', 'click', () => {
                this.settings.parcoordsTextVisible = !this.settings.parcoordsTextVisible;
                const btn = document.getElementById('btn-toggle-parcords-text');
                btn.classList.toggle('active', !this.settings.parcoordsTextVisible);
                btn.title = this.settings.parcoordsTextVisible ? 'Hide axis labels' : 'Show axis labels';
                this._renderParallelCoords();
            });

            // Parcoords font family
            on('parcords-font-family', 'change', (e) => {
                this.settings.parcoordsFontFamily = e.target.value;
                this._renderParallelCoords();
            });

            // Parcoords label font size
            on('parcords-font-size', 'input', (e) => {
                document.getElementById('parcords-font-size-val').textContent = e.target.value;
                this.settings.parcoordsLabelSize = parseInt(e.target.value);
                this._renderParallelCoords();
            });

            // Parcoords label font color
            on('parcords-font-color', 'input', (e) => {
                this.settings.parcoordsLabelColor = e.target.value;
                this._renderParallelCoords();
            });

            // Reset
            document.getElementById('btn-reset').addEventListener('click', () => {
                if (this.dm.rowCount > 0) this._renderAll();
            });

            // Export CSV
            on('btn-export', 'click', () => this._exportCSV());
        }

        // ---- Editable Titles ----
        _setupEditableTitles() {
            document.querySelectorAll('.editable-title').forEach(el => {
                el.addEventListener('dblclick', () => {
                    el.contentEditable = 'true';
                    el.classList.add('editing');
                    el.focus();

                    // Select all text
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                });

                el.addEventListener('blur', () => {
                    el.contentEditable = 'false';
                    el.classList.remove('editing');
                });

                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        el.blur();
                    }
                    if (e.key === 'Escape') {
                        el.blur();
                    }
                });
            });
        }

        // ---- Color Panel ----
        _setupColorPanel() {
            const panel = document.getElementById('color-panel');
            const overlay = document.getElementById('panel-overlay');

            document.getElementById('btn-color-panel').addEventListener('click', () => {
                this.colorPanelOpen = !this.colorPanelOpen;
                panel.classList.toggle('open', this.colorPanelOpen);
                overlay.classList.toggle('hidden', !this.colorPanelOpen);
            });

            document.getElementById('btn-close-color-panel').addEventListener('click', () => {
                this.colorPanelOpen = false;
                panel.classList.remove('open');
                overlay.classList.add('hidden');
            });

            overlay.addEventListener('click', () => {
                this.colorPanelOpen = false;
                panel.classList.remove('open');
                overlay.classList.add('hidden');
            });

            // Background color
            on('bg-color', 'input', (e) => {
                document.documentElement.style.setProperty('--bg-primary', e.target.value);
            });

            // Header color
            on('header-color', 'input', (e) => {
                document.documentElement.style.setProperty('--bg-header', e.target.value);
            });

            // Accent color
            on('accent-color', 'input', (e) => {
                document.documentElement.style.setProperty('--accent', e.target.value);
                this._renderScatter();
                this._renderHistogram();
            });

            // Chart line color
            on('chart-line-color', 'input', (e) => {
                document.documentElement.style.setProperty('--chart-line-color', e.target.value);
            });

            // Line opacity
            on('chart-line-opacity', 'input', (e) => {
                document.getElementById('opacity-value').textContent = e.target.value;
                document.documentElement.style.setProperty('--chart-line-opacity', e.target.value);
            });

            // Marker size
            on('marker-size', 'input', (e) => {
                document.getElementById('size-value').textContent = e.target.value;
                this._renderScatter();
            });

            // HSB custom color picker
            const hsbInputs = document.querySelectorAll('.hsb-range');
            hsbInputs.forEach(input => {
                input.addEventListener('input', () => updateHSBPreview());
            });
            // Initialize HSB preview
            updateHSBPreview();

            // Apply custom HSB gradient
            on('btn-apply-hsb', 'click', () => {
                const start = getHSBFromSliders('start');
                const end = getHSBFromSliders('end');
                const customScale = buildCustomColorscale(start, end, 10);
                this.settings.colorScale = customScale;
                // Set the scheme dropdown to indicate custom
                const schemeSelect = document.getElementById('color-scheme');
                // Add "Custom" option if not present
                let customOpt = schemeSelect.querySelector('option[value="custom"]');
                if (!customOpt) {
                    customOpt = document.createElement('option');
                    customOpt.value = 'custom';
                    customOpt.textContent = 'Custom (HSB)';
                    schemeSelect.insertBefore(customOpt, schemeSelect.firstChild);
                }
                schemeSelect.value = 'custom';
                if (this.dm.rowCount > 0) {
                    this._renderAll();
                }
            });

            // Theme presets
            document.querySelectorAll('.theme-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const theme = btn.dataset.theme;
                    // Remove all theme classes
                    document.body.className = document.body.className
                        .replace(/theme-\w+/g, '').trim();
                    if (theme !== 'light') {
                        document.body.classList.add(`theme-${theme}`);
                    }
                    // Re-render charts to pick up theme colors
                    if (this.dm.rowCount > 0) {
                        setTimeout(() => this._renderAll(), 50);
                    }
                });
            });
        }

        // ---- Label Settings Panel ----
        _setupLabelSettings() {
            const panel = document.getElementById('label-panel');
            const overlay = document.getElementById('panel-overlay');

            document.getElementById('btn-edit-labels').addEventListener('click', () => {
                this.labelPanelOpen = !this.labelPanelOpen;
                // Close color panel if open
                if (this.labelPanelOpen && this.colorPanelOpen) {
                    this.colorPanelOpen = false;
                    document.getElementById('color-panel').classList.remove('open');
                }

                panel.classList.toggle('open', this.labelPanelOpen);
                overlay.classList.toggle('hidden', !this.labelPanelOpen && !this.colorPanelOpen);

                if (this.labelPanelOpen) {
                    this._populateLabelInputs();
                }
            });

            document.getElementById('btn-close-label-panel').addEventListener('click', () => {
                this.labelPanelOpen = false;
                panel.classList.remove('open');
                if (!this.colorPanelOpen) overlay.classList.add('hidden');
            });

            // Also check overlay click to close label panel
            overlay.addEventListener('click', () => {
                this.labelPanelOpen = false;
                panel.classList.remove('open');
            });
        }

        _populateLabelInputs() {
            const container = document.getElementById('label-inputs-container');
            // Keep the instruction text, clear the rest
            const hint = container.querySelector('.setting-hint');
            container.innerHTML = '';
            if (hint) container.appendChild(hint);

            this.dm.dataColumns.forEach(col => {
                const group = document.createElement('div');
                group.className = 'setting-group';
                group.style.flexDirection = 'column';
                group.style.alignItems = 'flex-start';

                const label = document.createElement('label');
                label.className = 'setting-label';
                label.textContent = col;
                label.style.marginBottom = '4px';
                label.style.fontSize = '11px';
                label.style.color = 'var(--text-muted)';

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'export-num-input'; // Reuse style 
                input.style.width = '100%';
                input.value = this.customLabels[col] || cleanLabel(col);

                input.addEventListener('input', (e) => {
                    this.customLabels[col] = e.target.value;
                    // Debounce rendering slightly
                    clearTimeout(this._labelEditTimeout);
                    this._labelEditTimeout = setTimeout(() => {
                        this._renderParallelCoords();
                    }, 300);
                });

                group.appendChild(label);
                group.appendChild(input);
                container.appendChild(group);

                // If categorical, add inputs for its tick values
                const cats = this.dm.getCategories(col);
                if (cats) {
                    if (!this.customTickLabels[col]) {
                        this.customTickLabels[col] = {};
                    }
                    cats.forEach(c => {
                        const subGroup = document.createElement('div');
                        subGroup.className = 'setting-group';
                        subGroup.style.flexDirection = 'column';
                        subGroup.style.alignItems = 'flex-start';
                        subGroup.style.marginLeft = '12px';
                        subGroup.style.marginTop = '4px';

                        const subLabel = document.createElement('label');
                        subLabel.className = 'setting-label';
                        subLabel.textContent = `↳ ${c}`;
                        subLabel.style.marginBottom = '2px';
                        subLabel.style.fontSize = '10px';
                        subLabel.style.color = 'var(--text-muted)';

                        const subInput = document.createElement('input');
                        subInput.type = 'text';
                        subInput.className = 'export-num-input';
                        subInput.style.width = '100%';
                        subInput.style.padding = '2px 6px';
                        subInput.style.fontSize = '11px';
                        subInput.value = this.customTickLabels[col][c] || c;

                        subInput.addEventListener('input', (e) => {
                            this.customTickLabels[col][c] = e.target.value;
                            clearTimeout(this._labelEditTimeout);
                            this._labelEditTimeout = setTimeout(() => {
                                this._renderParallelCoords();
                            }, 300);
                        });

                        subGroup.appendChild(subLabel);
                        subGroup.appendChild(subInput);
                        container.appendChild(subGroup);
                    });
                }
            });
        }

        // ---- Lightbox ----
        _setupLightbox() {
            document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
            document.querySelector('.lightbox-backdrop').addEventListener('click', closeLightbox);
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeLightbox();
            });
        }

        // ---- Rendering ----
        _renderAll() {
            this._renderParallelCoords();
            this._renderScatter();
            this._renderHistogram();
            this._renderDataTable();
            this._renderGallery();
        }

        _renderParallelCoords() {
            renderParallelCoords(this.dm, 'parcords-chart', {
                colorDimension: this.settings.colorDimension,
                colorScale: this.settings.colorScale,
                showText: this.settings.parcoordsTextVisible,
                labelSize: this.settings.parcoordsLabelSize,
                labelColor: this.settings.parcoordsLabelColor,
                fontFamily: this.settings.parcoordsFontFamily,
                customLabels: this.customLabels,
                customTickLabels: this.customTickLabels
            });
        }

        _renderScatter() {
            renderScatterPlot(this.dm, 'scatter-chart', {
                xAxis: this.settings.scatterX,
                yAxis: this.settings.scatterY,
                colorDimension: this.settings.colorDimension,
                colorScale: this.settings.colorScale,
                sizeDimension: this.settings.scatterSize
            });
        }

        _renderHistogram() {
            renderHistogram(this.dm, 'histogram-chart', {
                variable: this.settings.histogramVar,
                colorScale: this.settings.colorScale
            });
        }

        _renderDataTable() {
            renderDataTable(this.dm, 'data-table');
        }

        _renderGallery() {
            renderImageGallery(this.dm, 'image-gallery', {
                sortBy: this.settings.gallerySortBy,
                sortOrder: this.settings.gallerySortOrder
            });
        }

        // ---- Export ----
        _exportCSV() {
            if (this.dm.rowCount === 0) return;
            const cols = [...this.dm.dataColumns, ...this.dm.columns.images];
            let csv = cols.join(',') + '\n';
            this.dm.rawData.forEach(row => {
                csv += cols.map(c => {
                    const val = row[c] || '';
                    return val.includes(',') ? `"${val}"` : val;
                }).join(',') + '\n';
            });

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'design_explorer_export.csv';
            a.click();
            URL.revokeObjectURL(url);
        }
    }

    // ================================================================
    //  UTILITY
    // ================================================================

    function on(id, event, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    }

    function setSelectValue(id, value) {
        const sel = document.getElementById(id);
        if (sel && value) sel.value = value;
    }

    // ================================================================
    //  EMBEDDED SAMPLE DATA (fallback when not served)
    // ================================================================

    const SAMPLE_CSV = `in:WWR (%),in:Shading Depth (in),in:Typical Insulation Value,out:Net EUI,img
15%,6,Typical Insulation-R12,65.608,Colibri_Results_1.png
15%,0,Typical Insulation-R12,65.588,Colibri_Results_1.png
20%,0,Typical Insulation-R12,66.493,Colibri_Results_1.png
25%,0,Typical Insulation-R12,67.417,Colibri_Results_1.png
30%,0,Typical Insulation-R12,68.355,Colibri_Results_1.png
15%,2,Typical Insulation-R12,65.595,Colibri_Results_1.png
20%,2,Typical Insulation-R12,66.501,Colibri_Results_1.png
25%,2,Typical Insulation-R12,67.426,Colibri_Results_1.png
30%,2,Typical Insulation-R12,68.367,Colibri_Results_1.png
15%,4,Typical Insulation-R12,65.602,Colibri_Results_1.png
20%,4,Typical Insulation-R12,66.51,Colibri_Results_1.png
25%,4,Typical Insulation-R12,67.437,Colibri_Results_1.png
30%,4,Typical Insulation-R12,68.378,Colibri_Results_1.png
20%,6,Typical Insulation-R12,66.518,Colibri_Results_1.png
25%,6,Typical Insulation-R12,67.446,Colibri_Results_1.png
30%,6,Typical Insulation-R12,68.389,Colibri_Results_1.png
15%,0,Typical Insulation-R25,65.588,Colibri_Results_1.png
20%,0,Typical Insulation-R25,66.493,Colibri_Results_1.png
25%,0,Typical Insulation-R25,67.417,Colibri_Results_1.png
30%,0,Typical Insulation-R25,68.355,Colibri_Results_1.png
15%,2,Typical Insulation-R25,65.595,Colibri_Results_1.png
20%,2,Typical Insulation-R25,66.501,Colibri_Results_1.png
25%,2,Typical Insulation-R25,67.426,Colibri_Results_1.png
30%,2,Typical Insulation-R25,68.367,Colibri_Results_1.png
15%,4,Typical Insulation-R25,65.602,Colibri_Results_1.png
20%,4,Typical Insulation-R25,66.51,Colibri_Results_1.png
25%,4,Typical Insulation-R25,67.437,Colibri_Results_1.png
30%,4,Typical Insulation-R25,68.378,Colibri_Results_1.png
15%,6,Typical Insulation-R25,65.608,Colibri_Results_1.png
20%,6,Typical Insulation-R25,66.518,Colibri_Results_1.png
25%,6,Typical Insulation-R25,67.446,Colibri_Results_1.png
30%,6,Typical Insulation-R25,68.389,Colibri_Results_1.png
15%,0,Typical Insulation-R50,65.588,Colibri_Results_1.png
20%,0,Typical Insulation-R50,66.493,Colibri_Results_1.png
25%,0,Typical Insulation-R50,67.417,Colibri_Results_1.png
30%,0,Typical Insulation-R50,68.355,Colibri_Results_1.png
15%,2,Typical Insulation-R50,65.595,Colibri_Results_1.png
20%,2,Typical Insulation-R50,66.501,Colibri_Results_1.png
25%,2,Typical Insulation-R50,67.426,Colibri_Results_1.png
30%,2,Typical Insulation-R50,68.367,Colibri_Results_1.png
15%,4,Typical Insulation-R50,65.602,Colibri_Results_1.png
20%,4,Typical Insulation-R50,66.51,Colibri_Results_1.png
25%,4,Typical Insulation-R50,67.437,Colibri_Results_1.png
30%,4,Typical Insulation-R50,68.378,Colibri_Results_1.png
15%,6,Typical Insulation-R50,65.608,Colibri_Results_1.png
20%,6,Typical Insulation-R50,66.518,Colibri_Results_1.png
25%,6,Typical Insulation-R50,67.446,Colibri_Results_1.png
30%,6,Typical Insulation-R50,68.389,Colibri_Results_1.png`;

    // ================================================================
    //  INITIALIZE
    // ================================================================

    window.addEventListener('DOMContentLoaded', () => {
        window.designExplorer = new App();
    });

})();
