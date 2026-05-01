const express = require('express');
const cors = require('cors');
const db = require('./database');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// ========== OLTs ==========
app.get('/api/olts', (req, res) => {
  const olts = db.prepare(`
    SELECT o.*, GROUP_CONCAT(json_object('id', p.id, 'port_number', p.port_number, 'power', p.power)) as ports_json
    FROM olts o LEFT JOIN olt_ports p ON p.olt_id = o.id
    GROUP BY o.id
  `).all();
  res.json(olts.map(o => ({
    ...o,
    ports: o.ports_json ? JSON.parse(`[${o.ports_json}]`) : []
  })));
});

app.post('/api/olts', (req, res) => {
  const { name, lat, lng, description, brand, model, ports_count = 16, power = 2.5 } = req.body;
  const result = db.prepare('INSERT INTO olts (name, lat, lng, description, brand, model, ports_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, lat, lng, description, brand, model, ports_count);
  
  // Create ports for the OLT
  const insertPort = db.prepare('INSERT INTO olt_ports (olt_id, port_number, power) VALUES (?, ?, ?)');
  for (let i = 1; i <= ports_count; i++) {
    insertPort.run(result.lastInsertRowid, i, power);
  }
  
  res.json({ id: result.lastInsertRowid, message: 'OLT creada' });
});

app.put('/api/olts/:id', (req, res) => {
  const { name, lat, lng, description, brand, model } = req.body;
  db.prepare('UPDATE olts SET name=?, lat=?, lng=?, description=?, brand=?, model=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(name, lat, lng, description, brand, model, req.params.id);
  res.json({ message: 'OLT actualizada' });
});

app.delete('/api/olts/:id', (req, res) => {
  db.prepare('DELETE FROM olts WHERE id=?').run(req.params.id);
  res.json({ message: 'OLT eliminada' });
});

// OLT port power update
app.put('/api/olt-ports/:id/power', (req, res) => {
  const { power } = req.body;
  db.prepare('UPDATE olt_ports SET power=? WHERE id=?').run(power, req.params.id);
  res.json({ message: 'Potencia actualizada' });
});

// ========== NAPs ==========
app.get('/api/naps', (req, res) => {
  const naps = db.prepare(`
    SELECT n.*, st.name as splitter_name, st.ports as splitter_ports, st.loss_db as splitter_loss,
      (SELECT COUNT(*) FROM nap_ports np WHERE np.nap_id = n.id) as used_ports
    FROM naps n LEFT JOIN splitter_types st ON st.id = n.splitter_type_id
    ORDER BY n.name
  `).all();
  
  // Get ports for each NAP
  const getPorts = db.prepare('SELECT * FROM nap_ports WHERE nap_id = ? ORDER BY port_number');
  return res.json(naps.map(n => ({ ...n, ports: getPorts.all(n.id) })));
});

app.post('/api/naps', (req, res) => {
  const { name, lat, lng, description, splitter_type_id, port_capacity = 8, address } = req.body;
  const result = db.prepare('INSERT INTO naps (name, lat, lng, description, splitter_type_id, port_capacity, address) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, lat, lng, description, splitter_type_id || null, port_capacity, address);
  
  // Create ports for the NAP
  const insertPort = db.prepare('INSERT INTO nap_ports (nap_id, port_number) VALUES (?, ?)');
  for (let i = 1; i <= port_capacity; i++) {
    insertPort.run(result.lastInsertRowid, i);
  }
  
  res.json({ id: result.lastInsertRowid, message: 'NAP creada' });
});

app.put('/api/naps/:id', (req, res) => {
  const { name, lat, lng, description, address, splitter_type_id } = req.body;
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name=?'); values.push(name); }
  if (lat !== undefined) { fields.push('lat=?'); values.push(lat); }
  if (lng !== undefined) { fields.push('lng=?'); values.push(lng); }
  if (description !== undefined) { fields.push('description=?'); values.push(description); }
  if (address !== undefined) { fields.push('address=?'); values.push(address); }
  if (splitter_type_id !== undefined) { fields.push('splitter_type_id=?'); values.push(splitter_type_id); }
  fields.push('updated_at=CURRENT_TIMESTAMP');
  
  if (fields.length > 1) {
    values.push(req.params.id);
    db.prepare(`UPDATE naps SET ${fields.join(', ')} WHERE id=?`).run(...values);
    
    // If splitter changed, regenerate ports
    if (splitter_type_id !== undefined) {
      const splitter = db.prepare('SELECT * FROM splitter_types WHERE id=?').get(splitter_type_id);
      if (splitter) {
        db.prepare('DELETE FROM nap_ports WHERE nap_id=?').run(req.params.id);
        db.prepare('UPDATE naps SET port_capacity=? WHERE id=?').run(splitter.ports, req.params.id);
        const insertPort = db.prepare('INSERT INTO nap_ports (nap_id, port_number) VALUES (?, ?)');
        for (let i = 1; i <= splitter.ports; i++) {
          insertPort.run(req.params.id, i);
        }
      }
    }
  }
  
  res.json({ message: 'NAP actualizada' });
});

app.delete('/api/naps/:id', (req, res) => {
  db.prepare('DELETE FROM naps WHERE id=?').run(req.params.id);
  res.json({ message: 'NAP eliminada' });
});

// Update NAP port (assign client, fiber)
app.put('/api/nap-ports/:id', (req, res) => {
  const { fiber_number, client_name, client_address, notes } = req.body;
  db.prepare('UPDATE nap_ports SET fiber_number=?, client_name=?, client_address=?, notes=? WHERE id=?')
    .run(fiber_number || null, client_name || null, client_address || null, notes || null, req.params.id);
  res.json({ message: 'Puerto actualizado' });
});

// ========== Mangas ==========
app.get('/api/mangas', (req, res) => {
  res.json(db.prepare('SELECT * FROM mangas ORDER BY name').all());
});

app.post('/api/mangas', (req, res) => {
  const { name, lat, lng, description } = req.body;
  const result = db.prepare('INSERT INTO mangas (name, lat, lng, description) VALUES (?, ?, ?, ?)')
    .run(name, lat, lng, description);
  res.json({ id: result.lastInsertRowid, message: 'Manga creada' });
});

app.put('/api/mangas/:id', (req, res) => {
  const { name, lat, lng, description } = req.body;
  db.prepare('UPDATE mangas SET name=?, lat=?, lng=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(name, lat, lng, description, req.params.id);
  res.json({ message: 'Manga actualizada' });
});

app.delete('/api/mangas/:id', (req, res) => {
  db.prepare('DELETE FROM mangas WHERE id=?').run(req.params.id);
  res.json({ message: 'Manga eliminada' });
});

// Manga splitters
app.get('/api/mangas/:id/splitters', (req, res) => {
  const splitters = db.prepare('SELECT ms.*, st.name as splitter_name, st.loss_db, (SELECT COUNT(*) FROM manga_fibers mf WHERE mf.splitter_id = ms.id AND mf.client_name IS NOT NULL) as used_ports FROM manga_splitters ms LEFT JOIN splitter_types st ON st.id = ms.splitter_type_id WHERE ms.manga_id = ?').all(req.params.id);
  res.json(splitters);
});

app.post('/api/mangas/:id/splitters', (req, res) => {
  const { name, splitter_type_id, ports_count, input_fiber } = req.body;
  const result = db.prepare('INSERT INTO manga_splitters (manga_id, name, splitter_type_id, ports_count, input_fiber) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, name || 'Splitter', splitter_type_id, ports_count || 8, input_fiber || null);
  
  // Auto-create manga_fibers for each output port of the splitter
  const splitterId = result.lastInsertRowid;
  const numPorts = ports_count || 8;
  const insertMF = db.prepare('INSERT INTO manga_fibers (manga_id, fiber_number, splitter_id, splitter_output, notes) VALUES (?, ?, ?, ?, ?)');
  
  // Check existing fiber count for unique fiber_number
  const maxFiber = db.prepare('SELECT COALESCE(MAX(fiber_number), 0) as m FROM manga_fibers WHERE manga_id=?').get(req.params.id);
  let fiberNum = (maxFiber?.m || 0) + 1;
  
  // Create input fiber for the splitter (first fiber before outputs)
  insertMF.run(req.params.id, fiberNum, splitterId, 0, 'Entrada splitter ' + (name || 'Splitter'));
  fiberNum++;
  
  // Create one manga_fiber per output port
  for (let i = 1; i <= numPorts; i++) {
    insertMF.run(req.params.id, fiberNum, splitterId, i, 'Salida ' + i + ' ' + (name || 'Splitter'));
    fiberNum++;
  }
  
  res.json({ id: splitterId, message: 'Splitter agregado a manga con ' + numPorts + ' fibras de salida' });
});

app.delete('/api/manga-splitters/:id', (req, res) => {
  // Delete associated manga_fibers first
  db.prepare('DELETE FROM manga_fibers WHERE splitter_id=?').run(req.params.id);
  db.prepare('DELETE FROM manga_splitters WHERE id=?').run(req.params.id);
  res.json({ message: 'Splitter y sus fibras eliminados' });
});

// Init fibers for existing splitter (migration)
app.post('/api/mangas/:mangaId/splitters/:splitterId/init-fibers', (req, res) => {
  const { mangaId, splitterId } = req.params;
  const { ports_count = 8 } = req.body;
  
  // Check if fibers already exist
  const existing = db.prepare('SELECT COUNT(*) as c FROM manga_fibers WHERE splitter_id=?').get(splitterId);
  if (existing.c > 0) {
    return res.json({ message: 'Ya tiene fibras' });
  }
  
  const maxFiber = db.prepare('SELECT COALESCE(MAX(fiber_number), 0) as m FROM manga_fibers WHERE manga_id=?').get(mangaId);
  let fiberNum = (maxFiber?.m || 0) + 1;
  
  const insertMF = db.prepare('INSERT INTO manga_fibers (manga_id, fiber_number, splitter_id, splitter_output, notes) VALUES (?, ?, ?, ?, ?)');
  
  // Create input fiber for the splitter
  insertMF.run(mangaId, fiberNum, splitterId, 0, 'Entrada splitter');
  fiberNum++;
  
  // Create output fibers
  for (let i = 1; i <= ports_count; i++) {
    insertMF.run(mangaId, fiberNum, splitterId, i, 'Salida ' + i);
    fiberNum++;
  }
  
  res.json({ message: 'Fibras creadas: 1 entrada + ' + ports_count + ' salidas' });
});

// Manga fibers
app.get('/api/mangas/:id/fibers', (req, res) => {
  const fibers = db.prepare('SELECT mf.*, ms.name as splitter_name FROM manga_fibers mf LEFT JOIN manga_splitters ms ON ms.id = mf.splitter_id WHERE mf.manga_id = ? ORDER BY mf.fiber_number').all(req.params.id);
  res.json(fibers);
});

app.post('/api/mangas/:id/fibers', (req, res) => {
  const { fiber_number, splitter_id, splitter_output, source_type, source_id, target_type, target_id } = req.body;
  db.prepare('INSERT INTO manga_fibers (manga_id, fiber_number, splitter_id, splitter_output, source_type, source_id, target_type, target_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, fiber_number, splitter_id || null, splitter_output || null, source_type, source_id, target_type, target_id);
  res.json({ message: 'Fibra agregada a manga' });
});

app.put('/api/manga-fibers/:id', (req, res) => {
  const { active_power, power_level, client_name, notes } = req.body;
  db.prepare('UPDATE manga_fibers SET active_power=?, power_level=?, client_name=?, notes=? WHERE id=?')
    .run(active_power ? 1 : 0, power_level || null, client_name || null, notes || null, req.params.id);
  res.json({ message: 'Fibra de manga actualizada' });
});

app.delete('/api/manga-fibers/:id', (req, res) => {
  db.prepare('DELETE FROM manga_fibers WHERE id=?').run(req.params.id);
  res.json({ message: 'Fibra eliminada de manga' });
});

// ========== Cables / Rutas ==========
app.get('/api/cables', (req, res) => {
  const cables = db.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM fiber_connections fc WHERE fc.cable_id = c.id) as fiber_count_used
    FROM cables c ORDER BY c.name
  `).all();
  
  const getPoints = db.prepare('SELECT * FROM cable_points WHERE cable_id = ? ORDER BY sequence');
  const getFibers = db.prepare(`
    SELECT fc.*, 
      CASE WHEN fc.source_type = 'olt' THEN (SELECT name FROM olts WHERE id = fc.source_id) END as source_name,
      CASE WHEN fc.source_type = 'manga' THEN (SELECT name FROM mangas WHERE id = fc.source_id) END as source_name2,
      CASE WHEN fc.target_type = 'nap' THEN (SELECT name FROM naps WHERE id = fc.target_id) END as target_name
    FROM fiber_connections fc WHERE fc.cable_id = ? ORDER BY fc.fiber_number
  `);
  
  return res.json(cables.map(c => ({
    ...c,
    points: getPoints.all(c.id),
    fibers: getFibers.all(c.id)
  })));
});

app.post('/api/cables', (req, res) => {
  const { name, fiber_count = 12, tube_count = 4, cable_type = 'ADSS', attenuation_db_per_km = 0.35, color = '#3388ff', length_m = 0, cable_type_id } = req.body;
  const result = db.prepare('INSERT INTO cables (name, fiber_count, tube_count, cable_type, attenuation_db_per_km, color, length_m, cable_type_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, fiber_count, tube_count, cable_type, attenuation_db_per_km, color, length_m, cable_type_id || null);
  res.json({ id: result.lastInsertRowid, message: 'Cable creado' });
});

app.put('/api/cables/:id', (req, res) => {
  const { name, color } = req.body;
  db.prepare('UPDATE cables SET name=?, color=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(name, color || '#3388ff', req.params.id);
  res.json({ message: 'Cable actualizado' });
});

app.delete('/api/cables/:id', (req, res) => {
  db.prepare('DELETE FROM cables WHERE id=?').run(req.params.id);
  res.json({ message: 'Cable eliminado' });
});

// Add/update cable points
app.post('/api/cables/:id/points', (req, res) => {
  const { points } = req.body; // array of {lat, lng, element_type?, element_id?}
  const cableId = req.params.id;
  db.prepare('DELETE FROM cable_points WHERE cable_id=?').run(cableId);
  const insert = db.prepare('INSERT INTO cable_points (cable_id, sequence, lat, lng, element_type, element_id) VALUES (?, ?, ?, ?, ?, ?)');
  points.forEach((p, i) => insert.run(cableId, i + 1, p.lat, p.lng, p.element_type || null, p.element_id || null));
  res.json({ message: 'Puntos guardados' });
});

// ========== Fiber Connections ==========
app.get('/api/fibers', (req, res) => {
  res.json(db.prepare(`
    SELECT fc.*, oltp.power as olt_power
    FROM fiber_connections fc
    LEFT JOIN olt_ports oltp ON oltp.id = fc.source_olt_port_id
    ORDER BY fc.cable_id, fc.fiber_number
  `).all());
});

app.post('/api/fibers', (req, res) => {
  const { cable_id, fiber_number, source_type, source_id, source_port_id, 
          target_type, target_id, target_port_id, source_olt_port_id } = req.body;
  
  // Calculate loss
  let total_loss = 0;
  let power_level = null;
  
  if (source_olt_port_id && source_type === 'olt') {
    const port = db.prepare('SELECT power FROM olt_ports WHERE id=?').get(source_olt_port_id);
    if (port) power_level = port.power;
  }
  
  const result = db.prepare(`INSERT INTO fiber_connections 
    (cable_id, fiber_number, source_type, source_id, source_port_id, target_type, target_id, target_port_id, source_olt_port_id, total_loss, power_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(cable_id, fiber_number, source_type, source_id, source_port_id || null, 
         target_type, target_id, target_port_id || null, source_olt_port_id || null, total_loss, power_level);
  
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/fibers/:id/activate', (req, res) => {
  const { active_power, power_level } = req.body;
  db.prepare('UPDATE fiber_connections SET active_power=?, power_level=?, total_loss=? WHERE id=?')
    .run(active_power ? 1 : 0, power_level || null, req.body.total_loss || 0, req.params.id);
  res.json({ message: 'Fibra actualizada' });
});

app.delete('/api/fibers/:id', (req, res) => {
  db.prepare('DELETE FROM fiber_connections WHERE id=?').run(req.params.id);
  res.json({ message: 'Fibra eliminada' });
});

// PUT /api/fibers/:id - general update (for power, activation, etc.)
app.put('/api/fibers/:id', (req, res) => {
  const { active_power, power_level, cable_id, fiber_number, source_type, source_id, source_port_id, target_type, target_id, target_port_id, source_olt_port_id } = req.body;
  
  const fiber = db.prepare('SELECT * FROM fiber_connections WHERE id=?').get(req.params.id);
  if (!fiber) return res.status(404).json({ error: 'Fibra no encontrada' });
  
  const fields = [];
  const values = [];
  
  if (active_power !== undefined) { fields.push('active_power=?'); values.push(active_power ? 1 : 0); }
  if (power_level !== undefined) { fields.push('power_level=?'); values.push(power_level); }
  if (cable_id !== undefined) { fields.push('cable_id=?'); values.push(cable_id); }
  if (fiber_number !== undefined) { fields.push('fiber_number=?'); values.push(fiber_number); }
  if (source_type !== undefined) { fields.push('source_type=?'); values.push(source_type); }
  if (source_id !== undefined) { fields.push('source_id=?'); values.push(source_id); }
  if (source_port_id !== undefined) { fields.push('source_port_id=?'); values.push(source_port_id); }
  if (target_type !== undefined) { fields.push('target_type=?'); values.push(target_type); }
  if (target_id !== undefined) { fields.push('target_id=?'); values.push(target_id); }
  if (target_port_id !== undefined) { fields.push('target_port_id=?'); values.push(target_port_id); }
  if (source_olt_port_id !== undefined) { fields.push('source_olt_port_id=?'); values.push(source_olt_port_id); }
  
  if (fields.length > 0) {
    values.push(req.params.id);
    db.prepare('UPDATE fiber_connections SET ' + fields.join(', ') + ' WHERE id=?').run(...values);
  }
  
  const updated = db.prepare('SELECT * FROM fiber_connections WHERE id=?').get(req.params.id);
  res.json({ message: 'Fibra actualizada', fiber: updated });
});

// ========== FOLDERS (Sistema de directorios) ==========

// Get full folder tree
app.get('/api/folders', (req, res) => {
  const folders = db.prepare('SELECT * FROM folders ORDER BY parent_id IS NULL DESC, parent_id, sort_order, name').all();
  
  // Get items for each folder
  const getItems = db.prepare('SELECT * FROM folder_items WHERE folder_id = ? ORDER BY sort_order, id');
  const foldersWithItems = folders.map(f => ({
    ...f,
    items: getItems.all(f.id)
  }));
  
  res.json(foldersWithItems);
});

// Create a folder
app.post('/api/folders', (req, res) => {
  const { name, parent_id } = req.body;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM folders WHERE parent_id IS ?').get(parent_id || null);
  const result = db.prepare('INSERT INTO folders (name, parent_id, sort_order) VALUES (?, ?, ?)')
    .run(name, parent_id || null, maxOrder.next);
  res.json({ id: result.lastInsertRowid, message: 'Carpeta creada' });
});

// Rename folder
app.put('/api/folders/:id', (req, res) => {
  const { name } = req.body;
  db.prepare('UPDATE folders SET name=? WHERE id=?').run(name, req.params.id);
  res.json({ message: 'Carpeta renombrada' });
});

// Move folder (change parent)
app.put('/api/folders/:id/move', (req, res) => {
  const { parent_id } = req.body;
  // Prevent circular reference
  if (parent_id) {
    let current = parent_id;
    while (current) {
      if (current == req.params.id) {
        return res.status(400).json({ error: 'No puedes mover una carpeta dentro de sí misma' });
      }
      const p = db.prepare('SELECT parent_id FROM folders WHERE id=?').get(current);
      current = p?.parent_id;
    }
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM folders WHERE parent_id IS ?').get(parent_id || null);
  db.prepare('UPDATE folders SET parent_id=?, sort_order=? WHERE id=?')
    .run(parent_id || null, maxOrder.next, req.params.id);
  res.json({ message: 'Carpeta movida' });
});

// Delete folder (cascade deletes sub-folders and items)
app.delete('/api/folders/:id', (req, res) => {
  const folderId = req.params.id;
  // Collect all descendant folder IDs
  const getAllChildIds = (parentId) => {
    const children = db.prepare('SELECT id FROM folders WHERE parent_id=?').all(parentId);
    let ids = [parseInt(parentId)];
    children.forEach(c => ids = ids.concat(getAllChildIds(c.id)));
    return ids;
  };
  const allIds = getAllChildIds(folderId);
  const placeholders = allIds.map(() => '?').join(',');
  // Delete all folder items in these folders
  db.prepare(`DELETE FROM folder_items WHERE folder_id IN (${placeholders})`).run(...allIds);
  // Delete all descendant folders (CASCADE will handle children)
  db.prepare(`DELETE FROM folders WHERE id IN (${placeholders})`).run(...allIds);
  res.json({ message: 'Carpeta eliminada' });
});

// Get items that are NOT in any folder (unassigned items)
app.get('/api/items-unassigned', (req, res) => {
  const oltIds = db.prepare('SELECT DISTINCT item_id FROM folder_items WHERE item_type=?')
    .all('olt').map(r => r.item_id);
  const napIds = db.prepare('SELECT DISTINCT item_id FROM folder_items WHERE item_type=?')
    .all('nap').map(r => r.item_id);
  const mangaIds = db.prepare('SELECT DISTINCT item_id FROM folder_items WHERE item_type=?')
    .all('manga').map(r => r.item_id);
  const cableIds = db.prepare('SELECT DISTINCT item_id FROM folder_items WHERE item_type=?')
    .all('cable').map(r => r.item_id);

  const unassignedOlts = oltIds.length > 0
    ? db.prepare(`SELECT id, name FROM olts WHERE id NOT IN (${oltIds.map(()=>'?').join(',')})`).all(...oltIds)
    : db.prepare('SELECT id, name FROM olts').all();
  const unassignedNaps = napIds.length > 0
    ? db.prepare(`SELECT id, name FROM naps WHERE id NOT IN (${napIds.map(()=>'?').join(',')})`).all(...napIds)
    : db.prepare('SELECT id, name FROM naps').all();
  const unassignedMangas = mangaIds.length > 0
    ? db.prepare(`SELECT id, name FROM mangas WHERE id NOT IN (${mangaIds.map(()=>'?').join(',')})`).all(...mangaIds)
    : db.prepare('SELECT id, name FROM mangas').all();
  const unassignedCables = cableIds.length > 0
    ? db.prepare(`SELECT id, name FROM cables WHERE id NOT IN (${cableIds.map(()=>'?').join(',')})`).all(...cableIds)
    : db.prepare('SELECT id, name FROM cables').all();

  res.json({ olts: unassignedOlts, naps: unassignedNaps, mangas: unassignedMangas, cables: unassignedCables });
});

// Add an item to a folder
app.post('/api/folder-items', (req, res) => {
  const { folder_id, item_type, item_id } = req.body;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM folder_items WHERE folder_id=?').get(folder_id);
  try {
    const result = db.prepare('INSERT INTO folder_items (folder_id, item_type, item_id, sort_order) VALUES (?, ?, ?, ?)')
      .run(folder_id, item_type, item_id, maxOrder.next);
    res.json({ id: result.lastInsertRowid, message: 'Item agregado a carpeta' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      res.json({ message: 'El item ya está en esta carpeta' });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// Move item to another folder
app.put('/api/folder-items/:id/move', (req, res) => {
  const { folder_id, new_type, new_item_id } = req.body;
  if (new_type && new_item_id) {
    // Update the item type/id as well (for repointing)
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM folder_items WHERE folder_id=?').get(folder_id);
    db.prepare('UPDATE folder_items SET folder_id=?, item_type=?, item_id=?, sort_order=? WHERE id=?')
      .run(folder_id, new_type, new_item_id, maxOrder.next, req.params.id);
  } else {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM folder_items WHERE folder_id=?').get(folder_id);
    db.prepare('UPDATE folder_items SET folder_id=?, sort_order=? WHERE id=?')
      .run(folder_id, maxOrder.next, req.params.id);
  }
  res.json({ message: 'Item movido' });
});

// Remove item from folder (doesn't delete the actual entity)
app.delete('/api/folder-items/:id', (req, res) => {
  db.prepare('DELETE FROM folder_items WHERE id=?').run(req.params.id);
  res.json({ message: 'Item removido de la carpeta' });
});

// Reorder items or folders
app.put('/api/folders/:id/reorder', (req, res) => {
  const { type, order } = req.body; // type: 'folder' | 'item', order: [{id, sort_order}]
  if (type === 'folder') {
    const update = db.prepare('UPDATE folders SET sort_order=? WHERE id=?');
    const txn = db.transaction(() => order.forEach(o => update.run(o.sort_order, o.id)));
    txn();
  } else {
    const update = db.prepare('UPDATE folder_items SET sort_order=? WHERE id=?');
    const txn = db.transaction(() => order.forEach(o => update.run(o.sort_order, o.id)));
    txn();
  }
  res.json({ message: 'Reordenado' });
});

// ========== Splices ==========
app.get('/api/splices', (req, res) => {
  const { manga_id } = req.query;
  if (manga_id) {
    return res.json(db.prepare('SELECT * FROM splices WHERE manga_id=? ORDER BY name').all(manga_id));
  }
  res.json(db.prepare('SELECT * FROM splices ORDER BY name').all());
});

app.post('/api/splices', (req, res) => {
  const { name, manga_id, loss_db = 0.1, lat, lng, fiber_a_type, fiber_a_id, fiber_a_port, fiber_b_type, fiber_b_id, fiber_b_port } = req.body;
  const result = db.prepare(`INSERT INTO splices (name, manga_id, loss_db, lat, lng, fiber_a_type, fiber_a_id, fiber_a_port, fiber_b_type, fiber_b_id, fiber_b_port)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name || 'Splice', manga_id || null, loss_db, lat || null, lng || null, 
         fiber_a_type, fiber_a_id, fiber_a_port, fiber_b_type, fiber_b_id, fiber_b_port);
  res.json({ id: result.lastInsertRowid, message: 'Splice creado' });
});

app.put('/api/splices/:id', (req, res) => {
  const { loss_db } = req.body;
  db.prepare('UPDATE splices SET loss_db=? WHERE id=?').run(loss_db, req.params.id);
  res.json({ message: 'Splice actualizado' });
});

app.delete('/api/splices/:id', (req, res) => {
  db.prepare('DELETE FROM splices WHERE id=?').run(req.params.id);
  res.json({ message: 'Splice eliminado' });
});

// ========== FUSIONS (empalmes) - Versión antigua reemplazada por la versión mejorada abajo ==========

// ========== Splitter Types ==========
app.get('/api/splitter-types', (req, res) => {
  res.json(db.prepare('SELECT * FROM splitter_types').all());
});

// ========== NAP Connections (splitter → fibers → clients) ==========
app.get('/api/naps/:id/connections', (req, res) => {
  const napId = req.params.id;
  const nap = db.prepare('SELECT n.*, st.name as splitter_name, st.ports as splitter_ports, st.loss_db as splitter_loss FROM naps n LEFT JOIN splitter_types st ON st.id = n.splitter_type_id WHERE n.id=?').get(napId);
  if (!nap) return res.status(404).json({ error: 'NAP no encontrada' });

  const ports = db.prepare('SELECT * FROM nap_ports WHERE nap_id=? ORDER BY port_number').all(napId);
  
  // Get fiber connections targeting this NAP
  const fiberCons = db.prepare(`
    SELECT fc.*, c.name as cable_name, cf.color as fiber_color, cf.color_name as fiber_color_name
    FROM fiber_connections fc
    LEFT JOIN cables c ON c.id = fc.cable_id
    LEFT JOIN cable_fibers cf ON cf.cable_id = fc.cable_id AND cf.fiber_number = fc.fiber_number
    WHERE (fc.target_type='nap' AND fc.target_id=?)
    ORDER BY fc.fiber_number
  `).all(napId);

  // Also look for connections where this NAP is the source
  const sourceCons = db.prepare(`
    SELECT fc.*, c.name as cable_name, cf.color as fiber_color, cf.color_name as fiber_color_name
    FROM fiber_connections fc
    LEFT JOIN cables c ON c.id = fc.cable_id
    LEFT JOIN cable_fibers cf ON cf.cable_id = fc.cable_id AND cf.fiber_number = fc.fiber_number
    WHERE (fc.source_type='nap' AND fc.source_id=?)
    ORDER BY fc.fiber_number
  `).all(napId);

  // Check for manga fibers connected to this NAP
  const mangaFibers = db.prepare(`
    SELECT mf.*, ms.name as splitter_name
    FROM manga_fibers mf
    LEFT JOIN manga_splitters ms ON ms.id = mf.splitter_id
    WHERE (mf.target_type='nap' AND mf.target_id=?) OR (mf.source_type='nap' AND mf.source_id=?)
    ORDER BY mf.fiber_number
  `).all(napId, napId);

  // Build output: for each port, show what's connected
  const portDetails = ports.map(port => {
    const fiberConn = fiberCons.find(fc => fc.target_port_id === port.id);
    const sourceConn = sourceCons.find(fc => fc.source_port_id === port.id);
    const mangaFiber = mangaFibers.find(mf => mf.fiber_number === port.fiber_number);
    
    let client_name = port.client_name || null;
    let fiber_number = port.fiber_number || null;
    let fiber_color = null;
    let fiber_color_name = null;
    let cable_name = null;
    let power_level = null;
    let active_power = false;
    let source = null;

    if (fiberConn) {
      fiber_number = fiberConn.fiber_number;
      fiber_color = fiberConn.fiber_color;
      fiber_color_name = fiberConn.fiber_color_name;
      cable_name = fiberConn.cable_name;
      power_level = fiberConn.power_level;
      active_power = !!fiberConn.active_power;
      source = { type: 'cable', id: fiberConn.cable_id, name: fiberConn.cable_name };
      // If port has a client name but was set via NAP port, keep it
    }
    if (mangaFiber) {
      fiber_color = null; // manga fibers may not have color
      fiber_color_name = null;
      if (mangaFiber.client_name) client_name = mangaFiber.client_name;
      if (mangaFiber.active_power) {
        active_power = true;
        power_level = mangaFiber.power_level;
      }
      source = { type: 'manga', id: null, name: mangaFiber.splitter_name || 'Manga' };
    }
    if (sourceConn) {
      source = { type: 'cable_out', id: sourceConn.cable_id, name: sourceConn.cable_name };
    }

    return {
      port_number: port.port_number,
      port_id: port.id,
      fiber_number,
      fiber_color,
      fiber_color_name,
      cable_name,
      client_name,
      client_address: port.client_address,
      notes: port.notes,
      active_power,
      power_level,
      source,
      connected: !!(fiberConn || mangaFiber || sourceConn || port.fiber_number || port.client_name)
    };
  });

  // Incoming cables feeding the NAP (input to splitter)
  const incoming = db.prepare(`
    SELECT fc.*, c.name as cable_name, cf.color as fiber_color, cf.color_name as fiber_color_name
    FROM fiber_connections fc
    LEFT JOIN cables c ON c.id = fc.cable_id
    LEFT JOIN cable_fibers cf ON cf.cable_id = fc.cable_id AND cf.fiber_number = fc.fiber_number
    WHERE fc.target_type='nap' AND fc.target_id=? AND fc.target_port_id IS NULL
  `).all(napId);

  res.json({
    nap: {
      id: nap.id,
      name: nap.name,
      splitter_name: nap.splitter_name,
      splitter_ports: nap.splitter_ports,
      splitter_loss: nap.splitter_loss,
      port_capacity: nap.port_capacity
    },
    ports: portDetails,
    fiber_connections: fiberCons,
    manga_fibers: mangaFibers,
    incoming_cables: incoming
  });
});

// ========== Connect cable fiber to NAP splitter port ==========
app.post('/api/fiber-connections/connect', (req, res) => {
  const { cable_id, fiber_number, nap_id, nap_port_id, client_name, client_address, power_level } = req.body;
  
  if (!cable_id || !fiber_number || !nap_id) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos: cable_id, fiber_number, nap_id' });
  }

  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cable_id);
  if (!cable) return res.status(404).json({ error: 'Cable no encontrado' });

  const nap = db.prepare('SELECT * FROM naps WHERE id=?').get(nap_id);
  if (!nap) return res.status(404).json({ error: 'NAP no encontrada' });

  // Check if this fiber is already connected
  const existing = db.prepare("SELECT * FROM fiber_connections WHERE cable_id=? AND fiber_number=? AND target_type='nap' AND target_id=?")
    .get(cable_id, fiber_number, nap_id);
  if (existing) {
    return res.status(400).json({ error: 'Esta fibra ya está conectada a esta NAP', existing_id: existing.id });
  }

  // Find or create nap_port_id
  let targetPortId = nap_port_id;
  if (!targetPortId) {
    // Find the first available port
    const freePort = db.prepare('SELECT id, port_number FROM nap_ports WHERE nap_id=? AND client_name IS NULL AND fiber_number IS NULL ORDER BY port_number LIMIT 1').get(nap_id);
    if (freePort) {
      targetPortId = freePort.id;
    } else {
      return res.status(400).json({ error: 'No hay puertos libres en esta NAP' });
    }
  }

  // Run everything in a transaction
  const result = db.transaction(() => {
    // 1. Create the fiber connection
    const insertConn = db.prepare(`INSERT INTO fiber_connections 
      (cable_id, fiber_number, source_type, source_id, target_type, target_id, target_port_id, power_level, active_power)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const connResult = insertConn.run(
      cable_id, fiber_number,
      'nap', nap_id,  // source is the NAP (from splitter perspective)
      'nap', nap_id, targetPortId,
      power_level || 0, power_level ? 1 : 0
    );

    // 2. Update cable_fibers status to 'used'
    const updateFiber = db.prepare("UPDATE cable_fibers SET status='used' WHERE cable_id=? AND fiber_number=?");
    updateFiber.run(cable_id, fiber_number);

    // 3. Update the NAP port with client info
    if (client_name || fiber_number) {
      const port = db.prepare('SELECT * FROM nap_ports WHERE id=?').get(targetPortId);
      if (port) {
        db.prepare('UPDATE nap_ports SET fiber_number=?, client_name=?, client_address=? WHERE id=?')
          .run(fiber_number, client_name || null, client_address || null, targetPortId);
      }
    }

    return connResult.lastInsertRowid;
  })();

  // Get the updated fiber info
  const fiberInfo = db.prepare(`
    SELECT cf.* FROM cable_fibers cf WHERE cf.cable_id=? AND cf.fiber_number=?
  `).get(cable_id, fiber_number);

  res.json({
    id: result,
    message: 'Fibra conectada exitosamente',
    fiber: fiberInfo,
    port_id: targetPortId
  });
});

// ========== Power Calculation ==========
// Helper: calculate cable distance in km (uses GPS points or length_m)
function calcCableDistanceKm(cableId) {
  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cableId);
  if (!cable) return 0;
  
  // If cable has explicit length_m, use that
  if (cable.length_m && cable.length_m > 0) {
    return cable.length_m / 1000;
  }
  
  // Fall back to GPS distance from cable points
  const cablePoints = db.prepare('SELECT * FROM cable_points WHERE cable_id=? ORDER BY sequence').all(cableId);
  if (cablePoints.length < 2) return 0;
  
  let total_distance_km = 0;
  for (let i = 1; i < cablePoints.length; i++) {
    const R = 6371;
    const dLat = (cablePoints[i].lat - cablePoints[i-1].lat) * Math.PI / 180;
    const dLng = (cablePoints[i].lng - cablePoints[i-1].lng) * Math.PI / 180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + 
              Math.cos(cablePoints[i-1].lat*Math.PI/180)*Math.cos(cablePoints[i].lat*Math.PI/180)*
              Math.sin(dLng/2)*Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    total_distance_km += R * c;
  }
  return total_distance_km;
}

// Helper: calculate total power loss for a fiber, following chain through fusions and splitters
function calculateFiberPowerChain(fiberConn, oltPower) {
  const result = {
    olt_power: oltPower || 0,
    distance_km: 0,
    cable_attenuation: 0,
    fusion_loss: 0,
    splitter_loss: 0,
    connector_loss: 1.0,
    total_loss: 0,
    remaining_power: 0,
    hops: [],
    _countedMangaSplitters: new Set(),
    _processedFusions: new Set()
  };
  
  let currentPower = oltPower || 0;
  
  // Track the fiber connection chain
  let fc = fiberConn;
  let visited = new Set();
  
  while (fc && !visited.has(fc.id)) {
    visited.add(fc.id);
    
    // Cable attenuation for this segment
    const distKm = calcCableDistanceKm(fc.cable_id);
    const cable = db.prepare('SELECT attenuation_db_per_km FROM cables WHERE id=?').get(fc.cable_id);
    const attenPerKm = cable?.attenuation_db_per_km || 0.35;
    const cableLoss = distKm * attenPerKm;
    
    result.distance_km += distKm;
    result.cable_attenuation += cableLoss;
    currentPower -= cableLoss;
    
    result.hops.push({
      type: 'cable',
      cable_id: fc.cable_id,
      fiber_number: fc.fiber_number,
      distance_km: distKm,
      cable_loss: cableLoss,
      power_after: Math.round(currentPower * 100) / 100
    });
    
    // If target is a NAP → add splitter loss
    if (fc.target_type === 'nap') {
      const nap = db.prepare('SELECT st.loss_db FROM naps n LEFT JOIN splitter_types st ON st.id = n.splitter_type_id WHERE n.id=?').get(fc.target_id);
      const napSplitterLoss = nap?.loss_db || 0;
      if (napSplitterLoss > 0) {
        result.splitter_loss += napSplitterLoss;
        currentPower -= napSplitterLoss;
        result.hops.push({
          type: 'nap_splitter',
          nap_id: fc.target_id,
          splitter_loss: napSplitterLoss,
          power_after: Math.round(currentPower * 100) / 100
        });
      }
    }
    
    // If source or target is a manga → check for manga splitter and fusions
    let nextFiberConn = null;
    
    // Look for fusions that connect from this fiber's cable point to another cable
    if (fc.source_type === 'manga' || fc.target_type === 'manga') {
      const mangaId = fc.source_type === 'manga' ? fc.source_id : fc.target_id;
      
      // Add manga splitter loss if present (only once per manga)
      if (!result._countedMangaSplitters.has(mangaId)) {
        const mangaSplitter = db.prepare(`
          SELECT st.loss_db FROM manga_splitters ms 
          LEFT JOIN splitter_types st ON st.id = ms.splitter_type_id 
          WHERE ms.manga_id = ?
        `).get(mangaId);
        
        if (mangaSplitter && mangaSplitter.loss_db > 0) {
          result._countedMangaSplitters.add(mangaId);
          result.splitter_loss += mangaSplitter.loss_db;
          currentPower -= mangaSplitter.loss_db;
          result.hops.push({
            type: 'manga_splitter',
            manga_id: mangaId,
            splitter_loss: mangaSplitter.loss_db,
            power_after: Math.round(currentPower * 100) / 100
          });
        }
      }
      
      // Find cable point for this fiber connection
      const cablePoint = db.prepare(`
        SELECT id FROM cable_points 
        WHERE cable_id = ? AND element_type = 'manga' AND element_id = ?
      `).get(fc.cable_id, mangaId);
      
      if (cablePoint) {
        // Find first fusion from this cable point with this fiber (follow one linear path)
        const fusion = db.prepare(`
          SELECT * FROM fusions 
          WHERE manga_id = ? AND cable_connection_id_in = ? AND fiber_in = ?
          LIMIT 1
        `).get(mangaId, cablePoint.id, fc.fiber_number);
        
        if (fusion) {
          result._processedFusions.add(fusion.id);
          const fusionLoss = fusion.loss_db || 0;
          result.fusion_loss += fusionLoss;
          currentPower -= fusionLoss;
          
          result.hops.push({
            type: 'fusion',
            fusion_id: fusion.id,
            fiber_in: fusion.fiber_in,
            fiber_out: fusion.fiber_out,
            fusion_loss: fusionLoss,
            power_after: Math.round(currentPower * 100) / 100
          });
          
          // Look for next fiber connection (outgoing from manga)
          if (fusion.cable_connection_id_out && fusion.fiber_out) {
            const outPoint = db.prepare('SELECT * FROM cable_points WHERE id = ?').get(fusion.cable_connection_id_out);
            if (outPoint) {
              const nextFC = db.prepare(`
                SELECT * FROM fiber_connections 
                WHERE cable_id = ? AND fiber_number = ?
              `).get(outPoint.cable_id, fusion.fiber_out);
              if (nextFC && !visited.has(nextFC.id)) {
                nextFiberConn = nextFC;
              }
            }
          }
        }
        
        // Also search for fusions where this fiber appears as OUT (reverse path)
        if (!fusion && !nextFiberConn) {
          const revFusion = db.prepare(`
            SELECT f.*, cp.cable_id as in_cable_id
            FROM fusions f
            LEFT JOIN cable_points cp ON cp.id = f.cable_connection_id_in
            WHERE f.manga_id = ? AND f.cable_connection_id_out = ? AND f.fiber_out = ?
            LIMIT 1
          `).get(mangaId, cablePoint.id, fc.fiber_number);
          
          if (revFusion && !result._processedFusions.has(revFusion.id)) {
            result._processedFusions.add(revFusion.id);
            const fusionLoss = revFusion.loss_db || 0;
            result.fusion_loss += fusionLoss;
            currentPower -= fusionLoss;
            
            result.hops.push({
              type: 'fusion_reverse',
              fusion_id: revFusion.id,
              fiber_in: revFusion.fiber_in,
              fiber_out: revFusion.fiber_out,
              fusion_loss: fusionLoss,
              power_after: Math.round(currentPower * 100) / 100
            });
            
            // Find the IN fiber connection
            if (revFusion.cable_connection_id_in && revFusion.fiber_in) {
              const inPoint = db.prepare('SELECT * FROM cable_points WHERE id = ?').get(revFusion.cable_connection_id_in);
              if (inPoint) {
                const prevFC = db.prepare(`
                  SELECT * FROM fiber_connections 
                  WHERE cable_id = ? AND fiber_number = ?
                `).get(inPoint.cable_id, revFusion.fiber_in);
                if (prevFC && !visited.has(prevFC.id)) {
                  // Recurse backward: calculate power for the input fiber
                  const prevResult = calculateFiberPowerChain(prevFC, currentPower + fusionLoss);
                  currentPower = prevResult.remaining_power - fusionLoss;
                  result.distance_km += prevResult.distance_km;
                  result.cable_attenuation += prevResult.cable_attenuation;
                  result.fusion_loss += prevResult.fusion_loss;
                  result.splitter_loss += prevResult.splitter_loss;
                  result.hops = [...prevResult.hops, ...result.hops];
                  break;
                }
              }
            }
          }
        }
      }
    }
    
    fc = nextFiberConn;
  }
  
  // Add connector losses
  const connLoss = result.hops.length > 0 ? 1.0 : 0.5;
  result.connector_loss = connLoss;
  currentPower -= connLoss;
  
  result.total_loss = Math.round((result.olt_power - currentPower) * 100) / 100;
  result.remaining_power = Math.round(currentPower * 100) / 100;
  result.is_good = result.remaining_power >= -28;
  
  return result;
}

// GET calculate-power by fiber_connection_id
app.get('/api/calculate-power/:fiberId', (req, res) => {
  const fiber = db.prepare('SELECT * FROM fiber_connections WHERE id=?').get(req.params.fiberId);
  if (!fiber) return res.status(404).json({ error: 'Fibra no encontrada' });
  
  // Get OLT port power
  let oltPower = 0;
  if (fiber.source_olt_port_id) {
    const port = db.prepare('SELECT power FROM olt_ports WHERE id=?').get(fiber.source_olt_port_id);
    oltPower = port ? port.power : 0;
  } else {
    // Try to find OLT power by following source chain
    const port = db.prepare('SELECT power FROM olt_ports WHERE id=?').get(fiber.source_port_id);
    oltPower = port ? port.power : 2.5;
  }
  
  const result = calculateFiberPowerChain(fiber, oltPower);
  res.json(result);
});

// POST calculate-power with custom parameters
app.post('/api/calculate-power', (req, res) => {
  const { fiber_connection_id, olt_power, include_fusions } = req.body;
  
  const fiber = db.prepare('SELECT * FROM fiber_connections WHERE id=?').get(fiber_connection_id);
  if (!fiber) return res.status(404).json({ error: 'Fibra no encontrada' });
  
  let basePower = olt_power;
  if (!basePower) {
    if (fiber.source_olt_port_id) {
      const port = db.prepare('SELECT power FROM olt_ports WHERE id=?').get(fiber.source_olt_port_id);
      basePower = port ? port.power : 0;
    } else {
      const port = db.prepare('SELECT power FROM olt_ports WHERE id=?').get(fiber.source_port_id);
      basePower = port ? port.power : 2.5;
    }
  }
  
  const result = calculateFiberPowerChain(fiber, basePower);
  res.json(result);
});

// ========== Stats ==========
app.get('/api/stats', (req, res) => {
  const olts = db.prepare('SELECT COUNT(*) as c FROM olts').get().c;
  const naps = db.prepare('SELECT COUNT(*) as c FROM naps').get().c;
  const mangas = db.prepare('SELECT COUNT(*) as c FROM mangas').get().c;
  const cables = db.prepare('SELECT COUNT(*) as c FROM cables').get().c;
  const fibers = db.prepare('SELECT COUNT(*) as c FROM fiber_connections').get().c;
  const activeFibers = db.prepare('SELECT COUNT(*) as c FROM fiber_connections WHERE active_power=1').get().c;
  res.json({ olts, naps, mangas, cables, fibers, activeFibers });
});

// ========== All data for map ==========
app.get('/api/map-data', (req, res) => {
  res.json({
    olts: db.prepare('SELECT id, name, lat, lng, description, ports_count FROM olts').all(),
    naps: db.prepare('SELECT n.id, n.name, n.lat, n.lng, n.description, n.port_capacity, st.name as splitter, (SELECT COUNT(*) FROM nap_ports np WHERE np.nap_id = n.id AND np.client_name IS NOT NULL) as clients FROM naps n LEFT JOIN splitter_types st ON st.id=n.splitter_type_id').all(),
    mangas: db.prepare("SELECT id, name, lat, lng, description FROM mangas").all(),
    cables: db.prepare(`
      SELECT c.id, c.name, c.color, c.fiber_count,
        (SELECT COUNT(*) FROM fiber_connections fc WHERE fc.cable_id=c.id AND fc.active_power=1) as active_fibers
      FROM cables c
    `).all(),
    cablePoints: db.prepare('SELECT * FROM cable_points ORDER BY cable_id, sequence').all(),
    fiberConnections: db.prepare('SELECT id, cable_id, fiber_number, source_type, source_id, target_type, target_id, active_power, power_level, total_loss FROM fiber_connections').all()
  });
});

// ========== CABLE TYPES ==========
app.get('/api/cable-types', (req, res) => {
  res.json(db.prepare('SELECT * FROM cable_types ORDER BY fiber_count').all());
});

app.post('/api/cable-types', (req, res) => {
  const { name, fiber_count, tube_count = 4, attenuation_db_per_km = 0.35 } = req.body;
  const result = db.prepare('INSERT INTO cable_types (name, fiber_count, tube_count, attenuation_db_per_km) VALUES (?, ?, ?, ?)')
    .run(name, fiber_count, tube_count, attenuation_db_per_km);
  res.json({ id: result.lastInsertRowid, name, fiber_count });
});

app.put('/api/cable-types/:id', (req, res) => {
  const { name, fiber_count, tube_count, attenuation_db_per_km } = req.body;
  db.prepare('UPDATE cable_types SET name=?, fiber_count=?, tube_count=?, attenuation_db_per_km=? WHERE id=?')
    .run(name, fiber_count, tube_count, attenuation_db_per_km, req.params.id);
  res.json({ success: true });
});

app.delete('/api/cable-types/:id', (req, res) => {
  db.prepare('DELETE FROM cable_types WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ========== CABLE FIBERS (fibras individuales de cada cable) ==========
app.get('/api/cables/:id/fibers', (req, res) => {
  const fibers = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? ORDER BY fiber_number').all(req.params.id);
  res.json(fibers);
});

app.post('/api/cables/:id/fibers/init', (req, res) => {
  const cableId = req.params.id;
  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cableId);
  if (!cable) return res.status(404).json({ error: 'Cable not found' });
  
  // Obtener colores estandar
  const colorCode = db.prepare('SELECT * FROM color_codes WHERE id=1').get();
  const colors = colorCode ? JSON.parse(colorCode.fusions_color_code_json) : [];
  
  const existing = db.prepare('SELECT COUNT(*) as c FROM cable_fibers WHERE cable_id=?').get(cableId);
  if (existing.c > 0) {
    return res.json({ message: 'Fibers already initialized', count: existing.c });
  }
  
  const insert = db.prepare('INSERT INTO cable_fibers (cable_id, fiber_number, color, color_name, status) VALUES (?, ?, ?, ?, ?)');
  const fiberCount = cable.fiber_count || 12;
  
  const insertMany = db.transaction((count) => {
    for (let i = 1; i <= count; i++) {
      const colorIdx = (i - 1) % colors.length;
      const color = colors[colorIdx] || { hex: '#cccccc', name: '' };
      insert.run(cableId, i, color.hex || '#cccccc', color.name || '', 'available');
    }
  });
  
  insertMany(fiberCount);
  const fibers = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? ORDER BY fiber_number').all(cableId);
  res.json(fibers);
});

app.put('/api/cable-fibers/:id', (req, res) => {
  const { status, notes } = req.body;
  const updates = [];
  if (status !== undefined) updates.push('status=?');
  if (notes !== undefined) updates.push('notes=?');
  if (updates.length === 0) return res.json({ success: false });
  
  const sql = 'UPDATE cable_fibers SET ' + updates.join(', ') + ' WHERE id=?';
  const params = [];
  if (status !== undefined) params.push(status);
  if (notes !== undefined) params.push(notes);
  params.push(req.params.id);
  
  db.prepare(sql).run(...params);
  res.json({ success: true });
});

// ========== COLOR CODES ==========
app.get('/api/color-codes', (req, res) => {
  res.json(db.prepare('SELECT * FROM color_codes').all());
});

app.put('/api/color-codes/:id', (req, res) => {
  const { name, connections_color_code_json, fusions_color_code_json } = req.body;
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name=?'); values.push(name); }
  if (connections_color_code_json !== undefined) { fields.push('connections_color_code_json=?'); values.push(connections_color_code_json); }
  if (fusions_color_code_json !== undefined) { fields.push('fusions_color_code_json=?'); values.push(fusions_color_code_json); }
  
  if (fields.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE color_codes SET ${fields.join(', ')} WHERE id=?`).run(...values);
    res.json({ message: 'Código de colores actualizado' });
  } else {
    res.json({ message: 'Sin cambios' });
  }
});

app.get('/api/color-codes/:id/colors', (req, res) => {
  const code = db.prepare('SELECT * FROM color_codes WHERE id=?').get(req.params.id);
  if (!code) return res.status(404).json({ error: 'Not found' });
  res.json({
    connections: JSON.parse(code.connections_color_code_json || '[]'),
    fusions: JSON.parse(code.fusions_color_code_json || '[]')
  });
});

app.get('/api/cables/:id/routing', (req, res) => {
  const cableId = req.params.id;
  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cableId);
  if (!cable) return res.status(404).json({ error: 'Not found' });
  
  const connections = db.prepare(`
    SELECT fc.*, 
      o.name as source_olt_name, n.name as source_nap_name, m.name as source_manga_name,
      o2.name as target_olt_name, n2.name as target_nap_name, m2.name as target_manga_name
    FROM fiber_connections fc
    LEFT JOIN olts o ON fc.source_type='olt' AND fc.source_id=o.id
    LEFT JOIN naps n ON fc.source_type='nap' AND fc.source_id=n.id
    LEFT JOIN mangas m ON fc.source_type='manga' AND fc.source_id=m.id
    LEFT JOIN olts o2 ON fc.target_type='olt' AND fc.target_id=o2.id
    LEFT JOIN naps n2 ON fc.target_type='nap' AND fc.target_id=n2.id
    LEFT JOIN mangas m2 ON fc.target_type='manga' AND fc.target_id=m2.id
    WHERE fc.cable_id=? ORDER BY fc.fiber_number
  `).all(cableId);
  
  const fibers = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? ORDER BY fiber_number').all(cableId);
  const points = db.prepare('SELECT * FROM cable_points WHERE cable_id=? ORDER BY sequence').all(cableId);
  
  const cablePointIds = points.map(p => p.id);
  let fusions = [];
  if (cablePointIds.length > 0) {
    const placeholders = cablePointIds.map(() => '?').join(',');
    fusions = db.prepare(`SELECT * FROM fusions WHERE cable_connection_id_in IN (${placeholders}) OR cable_connection_id_out IN (${placeholders})`)
      .all(...cablePointIds, ...cablePointIds);
  }
  
  res.json({ cable, fibers, connections, points, fusions });
});

// ========== INIT FIBERS FOR ALL EXISTING CABLES ==========
app.post('/api/cables/init-all-fibers', (req, res) => {
  const cables = db.prepare('SELECT id, fiber_count FROM cables').all();
  const colorCode = db.prepare('SELECT * FROM color_codes WHERE id=1').get();
  const colors = colorCode ? JSON.parse(colorCode.fusions_color_code_json) : [];
  const insert = db.prepare('INSERT OR IGNORE INTO cable_fibers (cable_id, fiber_number, color, color_name, status) VALUES (?, ?, ?, ?, ?)');
  
  let initialized = 0;
  cables.forEach(cable => {
    const existing = db.prepare('SELECT COUNT(*) as c FROM cable_fibers WHERE cable_id=?').get(cable.id);
    if (existing.c === 0) {
      for (let i = 1; i <= cable.fiber_count; i++) {
        const colorIdx = (i - 1) % colors.length;
        const color = colors[colorIdx] || { hex: '#cccccc', name: '' };
        insert.run(cable.id, i, color.hex || '#cccccc', color.name || '', 'available');
      }
      initialized++;
    }
  });
  res.json({ message: `Initialized fibers for ${initialized} cables` });
});

// ========== BATCH FIBER STATUS UPDATE (cable_fibers) ==========
app.post('/api/cable-fibers/batch-update', (req, res) => {
  const { updates } = req.body; // array of {id, status, notes, fiber_type}
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'Updates array is required' });
  }

  const updFields = [];
  const updVals = [];
  if (req.body.status !== undefined) updFields.push('status=?');
  if (req.body.notes !== undefined) updFields.push('notes=?');
  if (req.body.fiber_type !== undefined) updFields.push('fiber_type=?');

  if (updFields.length > 0) {
    // Apply same field to many IDs
    const sql = 'UPDATE cable_fibers SET ' + updFields.join(', ') + ', updated_at=CURRENT_TIMESTAMP WHERE id=?';
    const stmt = db.prepare(sql);
    const txn = db.transaction((items) => {
      items.forEach(item => {
        const params = [];
        if (req.body.status !== undefined) params.push(req.body.status);
        if (req.body.notes !== undefined) params.push(req.body.notes);
        if (req.body.fiber_type !== undefined) params.push(req.body.fiber_type);
        params.push(item.id);
        stmt.run(...params);
      });
    });
    txn(updates);
    res.json({ updated: updates.length, message: 'Fibras actualizadas por lote' });
  } else if (Array.isArray(updates) && updates.length > 0 && (
    updates[0].status !== undefined || updates[0].notes !== undefined || updates[0].fiber_type !== undefined
  )) {
    // Per-item updates
    const stmt = db.prepare('UPDATE cable_fibers SET status=COALESCE(?,status), notes=COALESCE(?,notes), fiber_type=COALESCE(?,fiber_type), updated_at=CURRENT_TIMESTAMP WHERE id=?');
    const txn = db.transaction((items) => {
      return items.map(item => {
        stmt.run(item.status || null, item.notes || null, item.fiber_type || null, item.id);
        return { id: item.id, status: item.status };
      });
    });
    const result = txn(updates);
    res.json({ updated: result.length, message: 'Fibras actualizadas por lote' });
  } else {
    res.status(400).json({ error: 'No valid fields provided for update' });
  }
});

// ========== CABLE-FIBERS BY MANGA (todas las fibras de cables que pasan por una manga) ==========
app.get('/api/mangas/:id/cable-fibers', (req, res) => {
  const mangaId = req.params.id;

  // Find all distinct cables whose route passes through this manga
  const cablesPassing = db.prepare(`
    SELECT DISTINCT cp.cable_id, c.name as cable_name, c.fiber_count, c.tube_count,
      c.cable_type, c.color, c.length_m, c.cable_type_id
    FROM cable_points cp
    JOIN cables c ON c.id = cp.cable_id
    WHERE cp.element_type = 'manga' AND cp.element_id = ?
  `).all(mangaId);

  // If no cable_points link, also check fusions that reference this manga
  // (some topologies may not have explicit cable_points for mangas)
  if (cablesPassing.length === 0) {
    const fusionCables = db.prepare(`
      SELECT DISTINCT fc.cable_id, c.name as cable_name, c.fiber_count, c.tube_count,
        c.cable_type, c.color, c.length_m, c.cable_type_id
      FROM fusions f
      JOIN fiber_connections fc ON fc.fiber_number = f.fiber_in AND (
        fc.cable_id = (SELECT cable_id FROM cable_points WHERE id = f.cable_connection_id_in)
      )
      JOIN cables c ON c.id = fc.cable_id
      WHERE f.manga_id = ?
    `).all(mangaId);
    cablesPassing.push(...fusionCables.filter(
      (c, i, arr) => arr.findIndex(x => x.cable_id === c.cable_id) === i
    ));
  }

  // If still none, try via cable_points where element_type starts with 'manga' (legacy)
  if (cablesPassing.length === 0) {
    const manga = db.prepare('SELECT * FROM mangas WHERE id=?').get(mangaId);
    if (manga) {
      // Search for cable_points near this manga location (within ~50m)
      const R = 6371000;
      const nearPoints = db.prepare(`
        SELECT DISTINCT cp.cable_id
        FROM cable_points cp
        WHERE (
          6371000 * 2 * ASIN(SQRT(
            POWER(SIN((? - cp.lat) * PI() / 360), 2) +
            COS(? * PI() / 180) * COS(cp.lat * PI() / 180) *
            POWER(SIN((? - cp.lng) * PI() / 360), 2)
          ))
        ) < 50
      `).all(manga.lat, manga.lat, manga.lng);

      if (nearPoints.length > 0) {
        const ids = nearPoints.map(p => p.cable_id);
        const placeholders = ids.map(() => '?').join(',');
        const detailCables = db.prepare(`
          SELECT id as cable_id, name as cable_name, fiber_count, tube_count,
            cable_type, color, length_m, cable_type_id
          FROM cables WHERE id IN (${placeholders})
        `).all(...ids);
        cablesPassing.push(...detailCables);
      }
    }
  }

  // Get fibers for each cable
  const result = cablesPassing.map(cable => {
    const fibers = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? ORDER BY fiber_number').all(cable.cable_id);
    return { ...cable, fibers };
  });

  res.json({
    manga_id: parseInt(mangaId),
    total_cables: result.length,
    total_fibers: result.reduce((sum, c) => sum + c.fibers.length, 0),
    cables: result
  });
});

// ========== FUSIONS (empalmes) - CRUD mejorado con vinculación a mangas ==========

// GET all fusions for a manga (con información detallada de cables de entrada/salida)
app.get('/api/mangas/:id/fusions', (req, res) => {
  const fusions = db.prepare(`
    SELECT f.*,
      c_in.name as cable_in_name, c_out.name as cable_out_name,
      c_in.color as cable_in_color, c_out.color as cable_out_color,
      fc_in.fiber_number as fc_fiber_in, fc_out.fiber_number as fc_fiber_out
    FROM fusions f
    LEFT JOIN cable_points cpi ON cpi.id = f.cable_connection_id_in
    LEFT JOIN cables c_in ON c_in.id = cpi.cable_id
    LEFT JOIN cable_points cpo ON cpo.id = f.cable_connection_id_out
    LEFT JOIN cables c_out ON c_out.id = cpo.cable_id
    LEFT JOIN fiber_connections fc_in ON fc_in.cable_id = cpi.cable_id AND fc_in.fiber_number = f.fiber_in
    LEFT JOIN fiber_connections fc_out ON fc_out.cable_id = cpo.cable_id AND fc_out.fiber_number = f.fiber_out
    WHERE f.manga_id = ?
    ORDER BY f.id
  `).all(req.params.id);
  res.json(fusions);
});

// GET single fusion with full detail
app.get('/api/fusions/:id', (req, res) => {
  const fusion = db.prepare(`
    SELECT f.*,
      c_in.name as cable_in_name, c_in.color as cable_in_color, c_in.fiber_count as cable_in_fibers,
      c_out.name as cable_out_name, c_out.color as cable_out_color, c_out.fiber_count as cable_out_fibers,
      m.name as manga_name,
      cp_in.lat as cable_in_lat, cp_in.lng as cable_in_lng,
      cp_out.lat as cable_out_lat, cp_out.lng as cable_out_lng
    FROM fusions f
    LEFT JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
    LEFT JOIN cables c_in ON c_in.id = cp_in.cable_id
    LEFT JOIN cable_points cp_out ON cp_out.id = f.cable_connection_id_out
    LEFT JOIN cables c_out ON c_out.id = cp_out.cable_id
    LEFT JOIN mangas m ON m.id = f.manga_id
    WHERE f.id = ?
  `).get(req.params.id);
  if (!fusion) return res.status(404).json({ error: 'Fusion no encontrada' });
  res.json(fusion);
});

// POST - create fusion (empalme) con validación
app.post('/api/fusions', (req, res) => {
  const {
    name, manga_id,
    cable_connection_id_in, fiber_in,
    cable_connection_id_out, fiber_out,
    connection_type = 0, loss_db = 0.0
  } = req.body;

  // Validate: must have cable_connection_id_in and fiber_in
  if (!cable_connection_id_in || !fiber_in) {
    return res.status(400).json({ error: 'cable_connection_id_in y fiber_in son requeridos' });
  }

  // Validate cable_point_in exists
  const pointIn = db.prepare('SELECT cp.*, c.name as cable_name FROM cable_points cp JOIN cables c ON c.id=cp.cable_id WHERE cp.id=?').get(cable_connection_id_in);
  if (!pointIn) {
    return res.status(400).json({ error: 'cable_connection_id_in no encontrado' });
  }

  // Validate fiber_in exists in cable_fibers
  const fiberExists = db.prepare('SELECT id FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(pointIn.cable_id, fiber_in);
  if (!fiberExists) {
    return res.status(400).json({ error: `Fibra #${fiber_in} no existe en el cable #${pointIn.cable_id}` });
  }

  // If cable_connection_id_out is provided, validate it too
  if (cable_connection_id_out) {
    const pointOut = db.prepare('SELECT cp.*, c.name as cable_name FROM cable_points cp JOIN cables c ON c.id=cp.cable_id WHERE cp.id=?').get(cable_connection_id_out);
    if (!pointOut) {
      return res.status(400).json({ error: 'cable_connection_id_out no encontrado' });
    }
    if (fiber_out) {
      const fiberOutExists = db.prepare('SELECT id FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(pointOut.cable_id, fiber_out);
      if (!fiberOutExists) {
        return res.status(400).json({ error: `Fibra #${fiber_out} no existe en el cable #${pointOut.cable_id}` });
      }
    }
  }

  const result = db.prepare(`INSERT INTO fusions (name, manga_id, cable_connection_id_in, fiber_in, cable_connection_id_out, fiber_out, connection_type, loss_db)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      name || `Empalme #${fiber_in}`,
      manga_id || null,
      cable_connection_id_in,
      fiber_in,
      cable_connection_id_out || null,
      fiber_out || null,
      connection_type,
      loss_db
    );

  // Update fiber status to 'used' if fusion is created
  if (result.lastInsertRowid) {
    db.prepare("UPDATE cable_fibers SET status='used', notes=COALESCE(notes || ' | ','') || 'fusion' WHERE cable_id=? AND fiber_number=?")
      .run(pointIn.cable_id, fiber_in);
  }

  const created = db.prepare('SELECT * FROM fusions WHERE id=?').get(result.lastInsertRowid);
  res.json({ id: result.lastInsertRowid, message: 'Empalme creado', fusion: created });
});

// PUT - update fusion
app.put('/api/fusions/:id', (req, res) => {
  const fusion = db.prepare('SELECT * FROM fusions WHERE id=?').get(req.params.id);
  if (!fusion) return res.status(404).json({ error: 'Fusion no encontrada' });

  const {
    name, manga_id,
    cable_connection_id_out, fiber_out,
    connection_type, loss_db
  } = req.body;

  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name=?'); params.push(name); }
  if (manga_id !== undefined) { updates.push('manga_id=?'); params.push(manga_id); }
  if (cable_connection_id_out !== undefined) { updates.push('cable_connection_id_out=?'); params.push(cable_connection_id_out); }
  if (fiber_out !== undefined) { updates.push('fiber_out=?'); params.push(fiber_out); }
  if (connection_type !== undefined) { updates.push('connection_type=?'); params.push(connection_type); }
  if (loss_db !== undefined) { updates.push('loss_db=?'); params.push(loss_db); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No hay campos para actualizar' });
  }

  params.push(req.params.id);
  db.prepare('UPDATE fusions SET ' + updates.join(', ') + ' WHERE id=?').run(...params);

  const updated = db.prepare('SELECT * FROM fusions WHERE id=?').get(req.params.id);
  res.json({ success: true, message: 'Empalme actualizado', fusion: updated });
});

// DELETE - delete fusion and optionally revert fiber status
app.delete('/api/fusions/:id', (req, res) => {
  const fusion = db.prepare(`
    SELECT f.*, cp.cable_id as cable_in_id
    FROM fusions f
    LEFT JOIN cable_points cp ON cp.id = f.cable_connection_id_in
    WHERE f.id = ?
  `).get(req.params.id);

  if (!fusion) return res.status(404).json({ error: 'Fusion no encontrada' });

  // Get the fiber_in from the fusion to revert its status
  if (fusion.cable_in_id && fusion.fiber_in) {
    // Check if this fiber is used by any OTHER fusion
    const otherFusions = db.prepare(`
      SELECT COUNT(*) as c FROM fusions
      WHERE cable_connection_id_in IN (
        SELECT id FROM cable_points WHERE cable_id=?
      ) AND fiber_in=? AND id != ?
    `).get(fusion.cable_in_id, fusion.fiber_in, req.params.id);

    if (otherFusions.c === 0) {
      // Only revert to 'available' if no other fusion uses this fiber
      db.prepare("UPDATE cable_fibers SET status='available' WHERE cable_id=? AND fiber_number=?")
        .run(fusion.cable_in_id, fusion.fiber_in);
    }
  }

  db.prepare('DELETE FROM fusions WHERE id=?').run(req.params.id);
  res.json({ success: true, message: 'Empalme eliminado' });
});

// ========== REPORTS SUMMARY ==========
app.get('/api/reports/summary', (req, res) => {
  const oltCount = db.prepare('SELECT COUNT(*) as c FROM olts').get().c;
  const napCount = db.prepare('SELECT COUNT(*) as c FROM naps').get().c;
  const mangaCount = db.prepare('SELECT COUNT(*) as c FROM mangas').get().c;
  const cableCount = db.prepare('SELECT COUNT(*) as c FROM cables').get().c;

  const totalFibers = db.prepare('SELECT COALESCE(SUM(fiber_count), 0) as c FROM cables').get().c;
  const usedFibers = db.prepare('SELECT COUNT(*) as c FROM fiber_connections').get().c;
  const activeFibers = db.prepare('SELECT COUNT(*) as c FROM fiber_connections WHERE active_power=1').get().c;

  const fusionCount = db.prepare('SELECT COUNT(*) as c FROM fusions').get().c;
  const spliceCount = db.prepare('SELECT COUNT(*) as c FROM splices').get().c;

  const avgFusionLoss = db.prepare('SELECT COALESCE(AVG(loss_db), 0) as avg FROM fusions WHERE loss_db > 0').get().avg;
  const avgSpliceLoss = db.prepare('SELECT COALESCE(AVG(loss_db), 0) as avg FROM splices WHERE loss_db > 0').get().avg;

  const napPortsTotal = db.prepare('SELECT COUNT(*) as c FROM nap_ports').get().c;
  const napPortsUsed = db.prepare("SELECT COUNT(*) as c FROM nap_ports WHERE client_name IS NOT NULL OR fiber_number IS NOT NULL").get().c;

  const cableLengthTotal = db.prepare('SELECT COALESCE(SUM(length_m), 0) as c FROM cables').get().c;

  const mangaFusions = db.prepare(`
    SELECT m.name as manga_name, COUNT(f.id) as fusion_count, COALESCE(AVG(f.loss_db), 0) as avg_loss
    FROM fusions f
    LEFT JOIN mangas m ON m.id = f.manga_id
    GROUP BY f.manga_id
  `).all();

  const cableFibersUsage = db.prepare(`
    SELECT c.name as cable_name, c.fiber_count as total, 
      (SELECT COUNT(*) FROM fiber_connections fc WHERE fc.cable_id = c.id) as used,
      (SELECT COUNT(*) FROM fiber_connections fc WHERE fc.cable_id = c.id AND fc.active_power = 1) as active
    FROM cables c
    ORDER BY c.name
  `).all();

  res.json({
    totals: { olts: oltCount, naps: napCount, mangas: mangaCount, cables: cableCount },
    fibers: {
      total: totalFibers, used: usedFibers, active: activeFibers, available: totalFibers - usedFibers
    },
    connections: {
      nap_ports_total: napPortsTotal, nap_ports_used: napPortsUsed, nap_ports_available: napPortsTotal - napPortsUsed
    },
    splices: {
      fusions: fusionCount, splices: spliceCount, total: fusionCount + spliceCount,
      avg_fusion_loss_db: Math.round(avgFusionLoss * 100) / 100,
      avg_splice_loss_db: Math.round(avgSpliceLoss * 100) / 100
    },
    infrastructure: {
      total_cable_length_m: cableLengthTotal,
      total_cable_length_km: Math.round(cableLengthTotal / 1000 * 100) / 100
    },
    fusion_by_manga: mangaFusions,
    cable_fibers_usage: cableFibersUsage
  });
});

// ========== FIBER ROUTE (complete path from OLT to client) ==========
app.get('/api/fibers/:id/route', (req, res) => {
  const fiber = db.prepare(`
    SELECT fc.*,
      o.name as source_olt_name, o.lat as source_olt_lat, o.lng as source_olt_lng,
      n.name as target_nap_name, n.lat as target_nap_lat, n.lng as target_nap_lng,
      n2.name as source_nap_name, n2.lat as source_nap_lat, n2.lng as source_nap_lng,
      m.name as source_manga_name, m.lat as source_manga_lat, m.lng as source_manga_lng,
      m2.name as target_manga_name, m2.lat as target_manga_lat, m2.lng as target_manga_lng,
      c.name as cable_name, c.color as cable_color, c.length_m as cable_length, c.fiber_count,
      c.attenuation_db_per_km,
      oltp.power as olt_port_power, oltp.port_number as olt_port_number
    FROM fiber_connections fc
    LEFT JOIN cables c ON c.id = fc.cable_id
    LEFT JOIN olts o ON fc.source_type='olt' AND fc.source_id=o.id
    LEFT JOIN naps n ON fc.target_type='nap' AND fc.target_id=n.id
    LEFT JOIN naps n2 ON fc.source_type='nap' AND fc.source_id=n2.id
    LEFT JOIN mangas m ON fc.source_type='manga' AND fc.source_id=m.id
    LEFT JOIN mangas m2 ON fc.target_type='manga' AND fc.target_id=m2.id
    LEFT JOIN olt_ports oltp ON oltp.id = fc.source_olt_port_id
    WHERE fc.id=?
  `).get(req.params.id);

  if (!fiber) return res.status(404).json({ error: 'Fibra no encontrada' });

  const cablePoints = db.prepare('SELECT * FROM cable_points WHERE cable_id=? ORDER BY sequence').all(fiber.cable_id);

  let distance_km = 0;
  for (let i = 1; i < cablePoints.length; i++) {
    const R = 6371;
    const dLat = (cablePoints[i].lat - cablePoints[i-1].lat) * Math.PI / 180;
    const dLng = (cablePoints[i].lng - cablePoints[i-1].lng) * Math.PI / 180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
              Math.cos(cablePoints[i-1].lat*Math.PI/180)*Math.cos(cablePoints[i].lat*Math.PI/180)*
              Math.sin(dLng/2)*Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    distance_km += R * c;
  }

  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(fiber.cable_id);
  const cable_attenuation = distance_km * (cable?.attenuation_db_per_km || 0.35);

  let fiberColor = null;
  let fiberColorName = null;
  if (fiber.cable_id && fiber.fiber_number) {
    const cf = db.prepare('SELECT color, color_name FROM cable_fibers WHERE cable_id=? AND fiber_number=?').get(fiber.cable_id, fiber.fiber_number);
    if (cf) { fiberColor = cf.color; fiberColorName = cf.color_name; }
  }

  const fusions = db.prepare(`
    SELECT f.*, m.name as manga_name
    FROM fusions f
    LEFT JOIN cable_points cp_in ON cp_in.id = f.cable_connection_id_in
    LEFT JOIN mangas m ON m.id = f.manga_id
    WHERE cp_in.cable_id = ?
      AND (f.fiber_in = ? OR f.fiber_out = ?)
    ORDER BY f.id
  `).all(fiber.cable_id, fiber.fiber_number, fiber.fiber_number);

  const splices = db.prepare(`
    SELECT s.* FROM splices s
    WHERE (s.fiber_a_id = ? AND s.fiber_a_port = ?)
       OR (s.fiber_b_id = ? AND s.fiber_b_port = ?)
  `).all(fiber.source_id, fiber.fiber_number, fiber.target_id, fiber.fiber_number);

  let initial_power = fiber.olt_port_power || 0;
  const fusion_losses = fusions.reduce((sum, f) => sum + (f.loss_db || 0), 0);
  const splice_losses = splices.reduce((sum, s) => sum + (s.loss_db || 0.1), 0);
  const splice_loss_total = fusion_losses + splice_losses;
  const connector_loss = 1.0;

  let splitter_loss = 0;
  let splitter_info = null;
  if (fiber.target_type === 'nap') {
    const nap = db.prepare(`
      SELECT n.*, st.name as splitter_type_name, st.loss_db as splitter_loss_db
      FROM naps n LEFT JOIN splitter_types st ON st.id = n.splitter_type_id WHERE n.id=?
    `).get(fiber.target_id);
    if (nap) {
      splitter_loss = nap.splitter_loss_db || 0;
      splitter_info = { name: nap.name, splitter_type: nap.splitter_type_name, loss_db: splitter_loss };
    }
  }

  const total_loss = Math.round((cable_attenuation + splice_loss_total + splitter_loss + connector_loss) * 100) / 100;
  const remaining_power = Math.round((initial_power - total_loss) * 100) / 100;

  const route_segments = [];

  if (fiber.source_type === 'olt') {
    route_segments.push({
      type: 'olt', name: fiber.source_olt_name || 'OLT #' + fiber.source_id,
      id: fiber.source_id, lat: fiber.source_olt_lat, lng: fiber.source_olt_lng,
      detail: 'Puerto ' + (fiber.olt_port_number || '?') + ' \u00b7 ' + initial_power + ' dBm',
      icon: '\u26a1'
    });
  } else if (fiber.source_type === 'nap') {
    route_segments.push({
      type: 'nap', name: fiber.source_nap_name || 'NAP #' + fiber.source_id,
      id: fiber.source_id, lat: fiber.source_nap_lat, lng: fiber.source_nap_lng,
      detail: 'Fuente', icon: '\uD83D\uDCE6'
    });
  } else if (fiber.source_type === 'manga') {
    route_segments.push({
      type: 'manga', name: fiber.source_manga_name || 'Manga #' + fiber.source_id,
      id: fiber.source_id, lat: fiber.source_manga_lat, lng: fiber.source_manga_lng,
      detail: 'Fuente', icon: '\uD83E\uDDF6'
    });
  }

  route_segments.push({
    type: 'cable', name: fiber.cable_name || 'Cable #' + fiber.cable_id,
    id: fiber.cable_id, fiber_number: fiber.fiber_number,
    fiber_color: fiberColor, fiber_color_name: fiberColorName,
    detail: 'Fibra #' + fiber.fiber_number + ' \u00b7 ' + Math.round(distance_km * 1000) + 'm \u00b7 ' + Math.round(cable_attenuation * 100) / 100 + ' dB atenuaci\u00f3n',
    icon: '\uD83D\uDD0C'
  });

  const mangaIds = [...new Set(fusions.filter(f => f.manga_id).map(f => f.manga_id))];
  mangaIds.forEach(mangaId => {
    const manga = db.prepare('SELECT * FROM mangas WHERE id=?').get(mangaId);
    const mangaFusions = fusions.filter(f => f.manga_id == mangaId);
    route_segments.push({
      type: 'manga', name: manga ? manga.name : 'Manga #' + mangaId,
      id: mangaId, lat: manga?.lat, lng: manga?.lng,
      detail: mangaFusions.length + ' empalmes \u00b7 ' + mangaFusions.reduce((s, f) => s + (f.loss_db || 0), 0).toFixed(2) + ' dB total',
      icon: '\uD83E\uDDF6', fusions: mangaFusions.map(f => ({ fiber_in: f.fiber_in, fiber_out: f.fiber_out, loss_db: f.loss_db }))
    });
  });

  splices.forEach((s, idx) => {
    route_segments.push({
      type: 'splice', name: 'Empalme #' + (idx + 1),
      id: s.id, detail: s.loss_db + ' dB p\u00e9rdida',
      icon: '\uD83D\uDD17', loss_db: s.loss_db
    });
  });

  if (fiber.target_type === 'nap') {
    route_segments.push({
      type: 'nap', name: fiber.target_nap_name || 'NAP #' + fiber.target_id,
      id: fiber.target_id, lat: fiber.target_nap_lat, lng: fiber.target_nap_lng,
      detail: splitter_info ? splitter_info.splitter_type + ' (' + splitter_loss + ' dB p\u00e9rdida)' : '',
      icon: '\uD83D\uDCE6', splitter: splitter_info
    });
  } else if (fiber.target_type === 'manga') {
    route_segments.push({
      type: 'manga', name: fiber.target_manga_name || 'Manga #' + fiber.target_id,
      id: fiber.target_id, lat: fiber.target_manga_lat, lng: fiber.target_manga_lng,
      icon: '\uD83E\uDDF6'
    });
  } else if (fiber.target_type === 'olt') {
    route_segments.push({
      type: 'olt', name: fiber.target_olt_name || 'OLT #' + fiber.target_id,
      icon: '\u26a1'
    });
  }

  res.json({
    fiber: {
      id: fiber.id, fiber_number: fiber.fiber_number, cable_id: fiber.cable_id,
      source_type: fiber.source_type, source_id: fiber.source_id,
      target_type: fiber.target_type, target_id: fiber.target_id,
      active_power: fiber.active_power, power_level: fiber.power_level,
      total_loss_stored: fiber.total_loss
    },
    route_segments: route_segments,
    power_analysis: {
      initial_power: initial_power,
      cable_distance_km: Math.round(distance_km * 100) / 100,
      cable_attenuation_db: Math.round(cable_attenuation * 100) / 100,
      fusion_loss_db: Math.round(fusion_losses * 100) / 100,
      splice_loss_db: Math.round(splice_losses * 100) / 100,
      splitter_loss_db: splitter_loss,
      connector_loss_db: connector_loss,
      total_loss_db: total_loss,
      remaining_power_db: remaining_power,
      is_good: remaining_power >= -28
    },
    cable_info: cable ? {
      name: cable.name, color: cable.color, fiber_count: cable.fiber_count,
      length_m: cable.length_m, attenuation_db_per_km: cable.attenuation_db_per_km
    } : null,
    fusions: fusions,
    splices: splices,
    cable_points: cablePoints
  });
});

// ========== CABLE POINTS (filtered by element_type/element_id) ==========
app.get('/api/cable-points', (req, res) => {
  const { element_type, element_id, cable_id } = req.query;
  if (cable_id) {
    const points = db.prepare('SELECT * FROM cable_points WHERE cable_id=? ORDER BY sequence').all(parseInt(cable_id));
    return res.json(points);
  }
  if (element_type && element_id) {
    const points = db.prepare('SELECT cp.*, c.name as cable_name FROM cable_points cp LEFT JOIN cables c ON c.id = cp.cable_id WHERE cp.element_type=? AND cp.element_id=? ORDER BY cp.cable_id, cp.sequence')
      .all(element_type, parseInt(element_id));
    return res.json(points);
  }
  res.json(db.prepare('SELECT cp.*, c.name as cable_name FROM cable_points cp LEFT JOIN cables c ON c.id = cp.cable_id ORDER BY cp.cable_id, cp.sequence').all());
});

// ========== Fusions by manga (GET) — with power calculation ==========
app.get('/api/fusions', (req, res) => {
  const { manga_id } = req.query;
  let fusions;
  if (manga_id) {
    fusions = db.prepare('SELECT * FROM fusions WHERE manga_id=? ORDER BY id').all(parseInt(manga_id));
  } else {
    fusions = db.prepare('SELECT * FROM fusions ORDER BY id').all();
  }
  
  // Calculate power for each fusion
  const fiberConns = db.prepare('SELECT * FROM fiber_connections').all();
  const powerReadings = db.prepare('SELECT * FROM power_readings ORDER BY timestamp DESC').all();
  
  fusions.forEach(f => {
    const connIn = db.prepare('SELECT * FROM cable_points WHERE id=?').get(f.cable_connection_id_in);
    let activePower = false;
    let powerLevel = null;
    
    if (connIn) {
      const fiberConn = fiberConns.find(fc => fc.cable_id == connIn.cable_id && fc.fiber_number == f.fiber_in);
      if (fiberConn) {
        activePower = fiberConn.active_power == 1 || fiberConn.active_power === true;
        if (fiberConn.power_level !== null && fiberConn.power_level !== undefined) {
          powerLevel = fiberConn.power_level;
        }
        const reading = powerReadings.find(r => r.fiber_connection_id == fiberConn.id);
        if (reading && reading.power_level !== null) {
          powerLevel = reading.power_level;
          activePower = reading.is_active == 1;
        }
      }
    }
    
    if (powerLevel !== null) {
      const loss = parseFloat(f.loss_db) || 0;
      f.power_level = powerLevel - loss;
    } else {
      f.power_level = null;
    }
    f.active_power = activePower;
  });
  
  res.json(fusions);
});

// ========== Power Readings ==========
app.post('/api/power-readings', (req, res) => {
  const { fiber_connection_id, element_type, element_id, power_level, is_active } = req.body;
  const result = db.prepare('INSERT INTO power_readings (fiber_connection_id, element_type, element_id, power_level, is_active) VALUES (?, ?, ?, ?, ?)')
    .run(fiber_connection_id || null, element_type, element_id, power_level || null, is_active ? 1 : 0);
  
  if (fiber_connection_id) {
    db.prepare('UPDATE fiber_connections SET power_level=?, active_power=? WHERE id=?')
      .run(power_level, is_active ? 1 : 0, fiber_connection_id);
  }
  
  res.json({ id: result.lastInsertRowid, message: 'Medición guardada' });
});

app.get('/api/power-readings', (req, res) => {
  const { element_type, element_id } = req.query;
  if (element_type && element_id) {
    return res.json(db.prepare('SELECT * FROM power_readings WHERE element_type=? AND element_id=? ORDER BY timestamp DESC LIMIT 50')
      .all(element_type, parseInt(element_id)));
  }
  res.json(db.prepare('SELECT * FROM power_readings ORDER BY timestamp DESC LIMIT 100').all());
});

// ========== CABLE CONNECTED ELEMENTS ==========
app.get('/api/cables/:id/connected-elements', (req, res) => {
  const cableId = req.params.id;
  const cable = db.prepare('SELECT * FROM cables WHERE id=?').get(cableId);
  if (!cable) return res.status(404).json({ error: 'Cable no encontrado' });

  const fiberConns = db.prepare('SELECT * FROM fiber_connections WHERE cable_id=?').all(cableId);

  const oltIds = [...new Set(fiberConns.filter(f => f.source_type === 'olt').map(f => f.source_id))];
  const napIds = [...new Set(fiberConns.filter(f => f.target_type === 'nap' || f.source_type === 'nap').map(f => f.target_type === 'nap' ? f.target_id : f.source_id))];
  const mangaIds = [...new Set(fiberConns.filter(f => f.target_type === 'manga' || f.source_type === 'manga').map(f => f.target_type === 'manga' ? f.target_id : f.source_id))];

  const cablePoints = db.prepare('SELECT * FROM cable_points WHERE cable_id=? AND element_type IS NOT NULL ORDER BY sequence').all(cableId);

  const olts = oltIds.length > 0
    ? db.prepare(`SELECT id, name, lat, lng, description, ports_count FROM olts WHERE id IN (${oltIds.map(()=>'?').join(',')})`).all(...oltIds) : [];
  const naps = napIds.length > 0
    ? db.prepare(`SELECT n.id, n.name, n.lat, n.lng, n.address, st.name as splitter_type,
        (SELECT COUNT(*) FROM nap_ports np WHERE np.nap_id = n.id AND np.client_name IS NOT NULL) as clients
      FROM naps n LEFT JOIN splitter_types st ON st.id = n.splitter_type_id
      WHERE n.id IN (${napIds.map(()=>'?').join(',')})`).all(...napIds) : [];
  const mangas = mangaIds.length > 0
    ? db.prepare(`SELECT id, name, lat, lng, description FROM mangas WHERE id IN (${mangaIds.map(()=>'?').join(',')})`).all(...mangaIds) : [];

  const directConnections = cablePoints.map(p => {
    let elementName = null;
    if (p.element_type === 'nap') { const n = naps.find(n => n.id == p.element_id); if (n) elementName = n.name; }
    else if (p.element_type === 'manga') { const m = mangas.find(m => m.id == p.element_id); if (m) elementName = m.name; }
    else if (p.element_type === 'olt') { const o = olts.find(o => o.id == p.element_id); if (o) elementName = o.name; }
    return { point_sequence: p.sequence, element_type: p.element_type, element_id: p.element_id, lat: p.lat, lng: p.lng, element_name: elementName };
  });

  const usedFibersCount = fiberConns.length;
  const activeFiberCount = fiberConns.filter(f => f.active_power).length;
  const fiberDetails = fiberConns.map(f => ({
    fiber_number: f.fiber_number, source_type: f.source_type, source_id: f.source_id,
    target_type: f.target_type, target_id: f.target_id, active_power: f.active_power
  }));

  const cableFibers = db.prepare('SELECT * FROM cable_fibers WHERE cable_id=? ORDER BY fiber_number').all(cableId);

  res.json({
    cable: { id: cable.id, name: cable.name, fiber_count: cable.fiber_count, length_m: cable.length_m },
    fiber_summary: {
      total: cable.fiber_count || 0, used: usedFibersCount,
      active: activeFiberCount, available: (cable.fiber_count || 0) - usedFibersCount
    },
    fiber_details: fiberDetails,
    cable_fibers: cableFibers,
    connected: { olts, naps, mangas },
    direct_connections: directConnections,
    cable_points_count: cablePoints.length,
    fusion_count: db.prepare(`
      SELECT COUNT(*) as c FROM fusions f
      LEFT JOIN cable_points cp ON cp.id IN (f.cable_connection_id_in, f.cable_connection_id_out)
      WHERE cp.cable_id = ?
    `).get(cableId).c
  });
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 FTTH Manager corriendo en http://0.0.0.0:${PORT}`);
});
