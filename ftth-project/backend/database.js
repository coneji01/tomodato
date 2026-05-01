const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'ftth.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Crear tablas
db.exec(`
  -- OLTs (Optical Line Terminals)
  CREATE TABLE IF NOT EXISTS olts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    description TEXT,
    brand TEXT,
    model TEXT,
    ports_count INTEGER DEFAULT 16,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- OLT Ports
  CREATE TABLE IF NOT EXISTS olt_ports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    olt_id INTEGER NOT NULL,
    port_number INTEGER NOT NULL,
    power REAL DEFAULT 2.5,
    name TEXT,
    FOREIGN KEY (olt_id) REFERENCES olts(id) ON DELETE CASCADE
  );

  -- Mangas (splice enclosures)
  CREATE TABLE IF NOT EXISTS mangas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    description TEXT,
    max_splices INTEGER DEFAULT 48,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Splitter Types (1x8, 1x16)
  CREATE TABLE IF NOT EXISTS splitter_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ports INTEGER NOT NULL,
    loss_db REAL NOT NULL
  );

  -- NAP Boxes (cajas de distribución)
  CREATE TABLE IF NOT EXISTS naps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    description TEXT,
    splitter_type_id INTEGER,
    port_capacity INTEGER DEFAULT 8,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (splitter_type_id) REFERENCES splitter_types(id)
  );

  -- NAP Ports (individual fiber outputs from a NAP splitter)
  CREATE TABLE IF NOT EXISTS nap_ports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nap_id INTEGER NOT NULL,
    port_number INTEGER NOT NULL,
    fiber_number INTEGER,
    client_name TEXT,
    client_address TEXT,
    notes TEXT,
    FOREIGN KEY (nap_id) REFERENCES naps(id) ON DELETE CASCADE
  );

  -- Cables / Routes (rutas de fibra entre elementos)
  CREATE TABLE IF NOT EXISTS cables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    fiber_count INTEGER DEFAULT 12,
    tube_count INTEGER DEFAULT 4,
    cable_type TEXT DEFAULT 'ADSS',
    attenuation_db_per_km REAL DEFAULT 0.35,
    color TEXT DEFAULT '#3388ff',
    length_m REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Cable points (waypoints for drawing the route on the map)
  CREATE TABLE IF NOT EXISTS cable_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cable_id INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    element_type TEXT,  -- 'olt', 'manga', 'nap', 'waypoint'
    element_id INTEGER,
    FOREIGN KEY (cable_id) REFERENCES cables(id) ON DELETE CASCADE
  );

  -- Fiber connections (which fiber goes where)
  CREATE TABLE IF NOT EXISTS fiber_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cable_id INTEGER NOT NULL,
    fiber_number INTEGER NOT NULL,
    source_type TEXT NOT NULL,  -- 'olt', 'manga', 'nap'
    source_id INTEGER NOT NULL,
    source_port_id INTEGER,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    target_port_id INTEGER,
    source_olt_port_id INTEGER,
    distance_m REAL DEFAULT 0,
    splice_count INTEGER DEFAULT 0,
    total_loss REAL DEFAULT 0,
    active_power BOOLEAN DEFAULT 0,
    power_level REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cable_id) REFERENCES cables(id) ON DELETE CASCADE
  );

  -- Manga Splitters (splitters dentro de una manga)
  CREATE TABLE IF NOT EXISTS manga_splitters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL,
    name TEXT,
    splitter_type_id INTEGER,
    ports_count INTEGER DEFAULT 8,
    input_fiber INTEGER,
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE CASCADE,
    FOREIGN KEY (splitter_type_id) REFERENCES splitter_types(id)
  );

  -- Manga Fibers (fibras dentro de una manga)
  CREATE TABLE IF NOT EXISTS manga_fibers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL,
    fiber_number INTEGER NOT NULL,
    splitter_id INTEGER,
    splitter_output INTEGER,
    source_type TEXT,
    source_id INTEGER,
    target_type TEXT,
    target_id INTEGER,
    client_name TEXT,
    notes TEXT,
    active_power BOOLEAN DEFAULT 0,
    power_level REAL,
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE CASCADE,
    FOREIGN KEY (splitter_id) REFERENCES manga_splitters(id) ON DELETE SET NULL
  );

  -- Folders (sistema de directorios tipo Explorer)
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
  );

  -- Folder Items (elementos dentro de carpetas)
  CREATE TABLE IF NOT EXISTS folder_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
    UNIQUE(folder_id, item_type, item_id)
  );

  -- Splices / Fusiones (empalmes individuales)
  CREATE TABLE IF NOT EXISTS splices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    manga_id INTEGER,
    lat REAL,
    lng REAL,
    loss_db REAL DEFAULT 0.1,
    fiber_a_type TEXT,
    fiber_a_id INTEGER,
    fiber_a_port INTEGER,
    fiber_b_type TEXT,
    fiber_b_id INTEGER,
    fiber_b_port INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE SET NULL
  );

  -- Reports / Power Readings
  CREATE TABLE IF NOT EXISTS power_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fiber_connection_id INTEGER,
    element_type TEXT NOT NULL,
    element_id INTEGER NOT NULL,
    power_level REAL,
    is_active BOOLEAN DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (fiber_connection_id) REFERENCES fiber_connections(id) ON DELETE SET NULL
  );

  -- Cable Types (tipos estandarizados de cable)
  CREATE TABLE IF NOT EXISTS cable_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    fiber_count INTEGER NOT NULL CHECK(fiber_count IN (4, 8, 12, 24, 48, 96, 144, 288)),
    tube_count INTEGER DEFAULT 4,
    attenuation_db_per_km REAL DEFAULT 0.35,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Cable Fibers (fibras individuales dentro de cada cable)
  CREATE TABLE IF NOT EXISTS cable_fibers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cable_id INTEGER NOT NULL,
    fiber_number INTEGER NOT NULL,
    color TEXT NOT NULL DEFAULT '#ffffff',
    color_name TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'used', 'reserved', 'broken')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cable_id) REFERENCES cables(id) ON DELETE CASCADE,
    UNIQUE(cable_id, fiber_number)
  );

  -- Color Codes (codigos de colores TIA/EIA-598)
  CREATE TABLE IF NOT EXISTS color_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    connections_color_code_json TEXT,
    fusions_color_code_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Fusions (empalmes/fusiones entre fibras dentro de mangas/CTOs)
  CREATE TABLE IF NOT EXISTS fusions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    manga_id INTEGER,
    cable_connection_id_in INTEGER NOT NULL,
    fiber_in INTEGER NOT NULL,
    cable_connection_id_out INTEGER,
    fiber_out INTEGER,
    connection_type INTEGER DEFAULT 0,
    loss_db REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (manga_id) REFERENCES mangas(id) ON DELETE SET NULL,
    FOREIGN KEY (cable_connection_id_in) REFERENCES cable_points(id) ON DELETE CASCADE,
    FOREIGN KEY (cable_connection_id_out) REFERENCES cable_points(id) ON DELETE SET NULL
  );
`);

// Migrations for existing databases
const colCheck = db.prepare("PRAGMA table_info(cables)").all();
if (!colCheck.find(c => c.name === 'length_m')) {
  db.exec('ALTER TABLE cables ADD COLUMN length_m REAL DEFAULT 0');
  console.log('✅ Migration: added length_m to cables');
}
if (!colCheck.find(c => c.name === 'cable_type_id')) {
  db.exec('ALTER TABLE cables ADD COLUMN cable_type_id INTEGER REFERENCES cable_types(id)');
  console.log('✅ Migration: added cable_type_id to cables');
}

// Migrations for cable_fibers
const cfColCheck = db.prepare("PRAGMA table_info(cable_fibers)").all();
if (!cfColCheck.find(c => c.name === 'fiber_type')) {
  db.exec("ALTER TABLE cable_fibers ADD COLUMN fiber_type TEXT DEFAULT 'distribution'");
  console.log('✅ Migration: added fiber_type to cable_fibers');
}
// Migration: ensure 1x6 splitter type exists
const twoPortSplitter = db.prepare("SELECT id FROM splitter_types WHERE ports=6").get();
if (!twoPortSplitter) {
  db.prepare('INSERT INTO splitter_types (name, ports, loss_db) VALUES (?, ?, ?)').run('1x6', 6, 9.0);
  console.log('✅ Migration: added 1x6 splitter type');
}

// Skipping updated_at migration - SQLite version compatibility issue
// if (!cfColCheck.find(c => c.name === 'updated_at')) {
//   db.exec('ALTER TABLE cable_fibers ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
//   console.log('✅ Migration: added updated_at to cable_fibers');
// }

// Insert default splitter types
const splitterCount = db.prepare('SELECT COUNT(*) as count FROM splitter_types').get();
if (splitterCount.count === 0) {
  db.prepare('INSERT INTO splitter_types (name, ports, loss_db) VALUES (?, ?, ?)').run('1x2', 2, 3.7);
  db.prepare('INSERT INTO splitter_types (name, ports, loss_db) VALUES (?, ?, ?)').run('1x4', 4, 7.0);
  db.prepare('INSERT INTO splitter_types (name, ports, loss_db) VALUES (?, ?, ?)').run('1x6', 6, 9.0);
  db.prepare('INSERT INTO splitter_types (name, ports, loss_db) VALUES (?, ?, ?)').run('1x8', 8, 10.5);
  db.prepare('INSERT INTO splitter_types (name, ports, loss_db) VALUES (?, ?, ?)').run('1x16', 16, 13.8);
  db.prepare('INSERT INTO splitter_types (name, ports, loss_db) VALUES (?, ?, ?)').run('1x32', 32, 16.5);
  db.prepare('INSERT INTO splitter_types (name, ports, loss_db) VALUES (?, ?, ?)').run('1x64', 64, 19.5);
  console.log("✅ Splitter types inserted");
}

// Insert default cable types
const cableTypeCount = db.prepare('SELECT COUNT(*) as count FROM cable_types').get();
if (cableTypeCount.count === 0) {
  const insertCableType = db.prepare('INSERT INTO cable_types (name, fiber_count, tube_count, attenuation_db_per_km) VALUES (?, ?, ?, ?)');
  insertCableType.run('ADSS 4 Fibras', 4, 1, 0.35);
  insertCableType.run('ADSS 8 Fibras', 8, 2, 0.35);
  insertCableType.run('ADSS 12 Fibras', 12, 4, 0.35);
  insertCableType.run('ADSS 24 Fibras', 24, 4, 0.35);
  insertCableType.run('ADSS 48 Fibras', 48, 4, 0.30);
  insertCableType.run('ADSS 96 Fibras', 96, 8, 0.30);
  insertCableType.run('ADSS 144 Fibras', 144, 12, 0.28);
  insertCableType.run('ADSS 288 Fibras', 288, 24, 0.25);
  console.log("✅ Cable types inserted");
}

// Insert default color codes (TIA/EIA-598)
const colorCodeCount = db.prepare('SELECT COUNT(*) as count FROM color_codes').get();
if (colorCodeCount.count === 0) {
  const standardColors = [
    {"number": 1, "name": "Azul", "hex": "#0077BB"},
    {"number": 2, "name": "Naranja", "hex": "#EE7733"},
    {"number": 3, "name": "Verde", "hex": "#009988"},
    {"number": 4, "name": "Marrón", "hex": "#8B4513"},
    {"number": 5, "name": "Pizarra", "hex": "#708090"},
    {"number": 6, "name": "Blanco", "hex": "#FFFFFF"},
    {"number": 7, "name": "Rojo", "hex": "#CC3311"},
    {"number": 8, "name": "Negro", "hex": "#222222"},
    {"number": 9, "name": "Amarillo", "hex": "#DDCC11"},
    {"number": 10, "name": "Violeta", "hex": "#AA3377"},
    {"number": 11, "name": "Rosa", "hex": "#EE7788"},
    {"number": 12, "name": "Aguamarina", "hex": "#33BBEE"}
  ];
  const connectionsJson = JSON.stringify(standardColors);
  const fusionsJson = JSON.stringify(standardColors);
  db.prepare('INSERT INTO color_codes (name, connections_color_code_json, fusions_color_code_json) VALUES (?, ?, ?)')
    .run('TIA/EIA-598 Estándar', connectionsJson, fusionsJson);
  console.log("✅ Color codes inserted");
}

console.log("✅ Database initialized");
module.exports = db;
