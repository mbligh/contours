/** Configured point overlays. File URLs are relative to the configuration file. */
export async function initGeoSources(map, maplibregl, container, configUrl) {
  const groups = [];
  let styleReady = map.isStyleLoaded();
  const document = container.ownerDocument;
  const message = text => {
    const node = document.createElement('div');
    node.className = 'hint';
    node.setAttribute('role', 'status');
    node.textContent = text;
    container.append(node);
    return node;
  };
  function install(group) {
    if (!styleReady) return;
    group.status.textContent = '';
    for (const item of group.items) {
      try {
        if (group.check.checked && !map.getSource(item.id)) {
          map.addSource(item.id, {type: 'geojson', data: item.url});
        }
        if (group.check.checked && !map.getLayer(item.id)) {
          map.addLayer({...item.style, id: item.id, source: item.id,
            layout: {...item.style.layout, visibility: 'visible'}});
        }
        if (map.getLayer(item.id)) {
          map.setLayoutProperty(item.id, 'visibility', group.check.checked ? 'visible' : 'none');
        }
      } catch (error) {
        group.status.textContent = `${group.name}: ${error.message}`;
      }
    }
  }
  map.on('style.load', () => {
    styleReady = true;
    groups.forEach(install);
  });
  map.on('error', event => {
    for (const group of groups) {
      if (group.items.some(item => item.id === event.sourceId)) {
        group.status.textContent = `${group.name}: ${event.error?.message || 'Unable to load GeoJSON'}`;
      }
    }
  });
  try {
    const response = await fetch(configUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    if (!Array.isArray(config)) throw new Error('Expected a list of layers');
    config.forEach((entry, groupIndex) => {
      try {
        const name = entry?.name ?? entry?.layer;
        if (typeof name !== 'string' || !name.trim()) throw new Error('Layer needs a name');
        if (!Array.isArray(entry.data) || !entry.data.length) throw new Error(`${name}: data must be a non-empty list`);
        const items = entry.data.map((data, dataIndex) => {
          if (typeof data?.file !== 'string' || !data.file.trim()) throw new Error(`${name}: each dataset needs a file`);
          const url = new URL(data.file, configUrl);
          if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`${name}: unsupported file URL`);
          const type = data.type ?? 'circle';
          if (!['circle', 'symbol'].includes(type)) throw new Error(`${name}: point type must be circle or symbol`);
          const style = {type};
          for (const key of ['paint', 'layout', 'filter', 'minzoom', 'maxzoom']) {
            if (data[key] !== undefined) style[key] = data[key];
          }
          return {id: `geosources-${groupIndex}-${dataIndex}`, url: url.href, style};
        });
        const label = document.createElement('label');
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.id = `geosources-toggle-${groupIndex}`;
        label.append(check, document.createTextNode(` ${name}`));
        container.append(label);
        const group = {name, items, check, status: message('')};
        groups.push(group);
        check.addEventListener('change', () => install(group));
        for (const item of items) {
          map.on('click', item.id, event => {
            if (!check.checked || !event.features?.length) return;
            const content = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = name;
            content.append(title);
            for (const [key, value] of Object.entries(event.features[0].properties || {})) {
              if (value == null) continue;
              const row = document.createElement('div');
              row.textContent = `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`;
              content.append(row);
            }
            new maplibregl.Popup().setLngLat(event.lngLat).setDOMContent(content).addTo(map);
          });
          map.on('mouseenter', item.id, () => { if (check.checked) map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', item.id, () => { map.getCanvas().style.cursor = ''; });
        }
        install(group);
      } catch (error) {
        message(`Configured layer ${groupIndex + 1}: ${error.message}`);
      }
    });
  } catch (error) {
    message(`Unable to load layer configuration: ${error.message}`);
  }
}
