// EDDO OS · House model (from the Shortland Gardens floor plan).
// Metres. x = across the house from the left wall as drawn on the plan,
// z = from the front of the house (street) towards the garden.
// Each room lights up from the Home Assistant area whose name matches one of
// its `areas` (case-insensitive), plus any `entities` listed directly.
// Edit freely: sizes, the garden gap, names, area names.
window.EDDO_HOUSE = {
  name: "Shortland Gardens",
  site: { lat: 51.4057, lon: 0.0158, northDeg: 45 },   // plan north points up-right (45° clockwise from the plan's "up")
  // Faint outline of the whole building (from the street + aerial photos). Heights
  // follow the separated floors of the model, so the shell wraps them.
  shell: {
    main: { x0: 0, x1: 4.6, z0: 0, z1: 7.41, eaves: 6.9, ridge: 11.6, ridgeZ: 3.0 },     // pitched roof, ridge along the street
    dormer: { x0: 0.15, x1: 4.6, z0: 3.0, z1: 7.41, top: 11.0, slope: true },             // loft dormer at the back: its roof falls gently from the ridge
    chimneys: [                                                                              // the one stack, on the left, with its pots
      { x0: 0.25, x1: 1.1, z0: 2.6, z1: 3.4, top: 13.0, pots: 3 },
    ],
    rooflights: [{ x0: 2.2, x1: 3.1, t0: 0.45, t1: 0.8 }, { x0: 3.95, x1: 4.35, t0: 0.55, t1: 0.85 }],   // on the front slope, t = 0 eaves to 1 ridge
    // front windows (z = 0 face); y is height above the ground in the exploded model. sash = mullion + meeting rail
    windows: [
      { face: "front", x0: 0.6, x1: 2.8, y0: 4.3, y1: 5.95, sash: true },        // spare room, above the bay
      { face: "front", x0: 3.65, x1: 4.2, y0: 4.35, y1: 5.95, sash: true, single: true },  // over the front door
      { face: "rear", x0: 0.6, x1: 1.8, y0: 8.6, y1: 9.9 },                       // loft dormer
      { face: "rear", x0: 2.5, x1: 3.9, y0: 8.6, y1: 9.9 },
    ],
    door: { x0: 3.5, x1: 4.4, recess: 0.55, spring: 2.1 },                        // arched porch with the front door set back
    frontWall: { x0: -0.1, x1: 3.3, z: -1.7, h: 0.85, piers: [-0.1, 3.05] },       // low brick wall and the tiled path
    downpipe: { x: 3.33 },
    outrigger: { x0: 2.08, x1: 4.6, z0: 7.41, z1: 9.87, eaves: 6.9, ridge: 8.3 },         // two storeys over kitchen + bathroom
    extension: { x0: 2.08, x1: 4.6, z0: 9.87, z1: 12.0, high: 3.5, low: 2.95 },          // single-storey kitchen end, lean-to roof
    bay: { x0: 0.5, x1: 2.9, depth: 0.45, top: 2.2, roof: 2.75 },                         // front bay window and its little tiled roof
  },
  // back garden (from the photo taken at the office): decking along the side return and across
  // the back of the kitchen with an angled corner, artificial lawn, then the office. Outline only.
  garden: {
    decks: [[[0, 7.41], [2.08, 7.41], [2.08, 12.0], [4.6, 12.0], [4.6, 13.4], [2.7, 13.4], [2.1, 12.9], [0, 12.9]]],
    items: [
      { name: "Garden furniture (covered)", x0: 2.35, x1: 4.25, z0: 12.1, z1: 13.15, h: 0.85 },
      { name: "Storage box", x0: 0.1, x1: 0.95, z0: 11.3, z1: 11.95, h: 0.75 },
      { name: "Planters", x0: 4.2, x1: 4.55, z0: 12.95, z1: 13.35, h: 0.5 },
      { name: "Planters", x0: 0.15, x1: 0.45, z0: 12.45, z1: 12.8, h: 0.45 },
      { name: "Rotary washing line", kind: "rotary", x: 2.35, z: 13.9, h: 1.9, r: 1.1 },
      { name: "Garden chair", kind: "chair", x0: 0.45, x1: 1.05, z0: 13.7, z1: 14.3, h: 0.9 },
      { name: "Weber BBQ", kind: "bbq", x0: 4.0, x1: 4.6, z0: 15.2, z1: 15.95, h: 1.15 },
      { name: "Maple", kind: "tree", x: 0.1, z: 15.9, r: 1.5, y0: 1.8, h: 4.2 },
      { name: "Shrubs", kind: "tree", x: 4.85, z: 13.9, r: 0.8, y0: 0.6, h: 2.6 },
    ],
  },
  // doors with contact sensors in Home Assistant, matched by name. Any other door/window sensor is
  // placed on the back wall of the room its HA area matches. wall: front/back/left/right (plan sides),
  // at: 0–1 along that wall, w: width, hinge: "far" flips the hinge side, out: true opens outwards.
  doors: [
    { name: "Front door", room: "hall", wall: "front", at: 0.46, w: 0.84, inset: 0.55, entity: "binary_sensor.front_door" },
    { name: "Kitchen door", room: "kitchen", wall: "left", at: 0.12, w: 0.8, entity: "binary_sensor.kitchen_door" },   // onto the side return, by the garden camera
    { name: "Office door", room: "office", wall: "front", at: 0.5, w: 0.8, out: true, entity: "binary_sensor.garage_door" },   // faces the house
    { name: "Dining window", room: "dining", wall: "back", at: 0.3, w: 1.0, window: true, entity: "binary_sensor.back_window" },   // below the garden camera
    { name: "Fox's window", room: "fox", wall: "back", at: 0.5, w: 1.0, window: true, entity: "binary_sensor.lumi_lumi_sensor_magnet_aq2_opening_2" },
  ],
  // home server (Unraid): a small box under Ed's desk in the office, with its CPU temperature
  server: { name: "EDDO-NAS", room: "office", u: 0.9, v: 0.14, w: 0.24, h: 0.42, d: 0.42 },
  boiler: { room: "bath", u: 0.92, v: 0.2, y: 1.3 },   // in the tall cupboard by the bathroom door
  floorHeight: 2.6,
  floorGap: 1.3,                 // extra space between floors so each level reads clearly
  floors: [
    {
      id: "ground", name: "Ground floor",
      rooms: [
        { id: "living", name: "Living Room", x: 0, z: 0, w: 3.4, d: 4.04, bay: true,
          areas: ["living room", "lounge", "reception"],
          entities: ["light.living_room", "light.living_room_light", "light.candle", "light.dougnut_lamp"], scenes: ["scene.movie_time"] },
        { id: "dining", name: "Dining Room", x: 0, z: 4.04, w: 3.4, d: 3.37, areas: ["dining room", "dining"] },
        { id: "hall", name: "Hallway", x: 3.4, z: 0, w: 1.2, d: 7.41, areas: ["hallway", "hall", "entrance"], quiet: true },
        { id: "kitchen", name: "Kitchen", x: 2.08, z: 7.41, w: 2.52, d: 4.59, areas: ["kitchen"],
          entities: ["light.kitchen_top_lights"] },
      ],
    },
    {
      id: "first", name: "First floor",   // the spare room has no sensor yet, so it shows Fox's room temperature (tempFrom)
      rooms: [
        { id: "spare", name: "Spare Room", x: 0, z: 0, w: 4.6, d: 3.43, tempFrom: "fox", areas: ["spare room", "guest room", "bedroom 2"] },
        { id: "fox", name: "Fox's Room", x: 0, z: 3.43, w: 2.63, d: 3.37, areas: ["fox's room", "fox room", "foxs room", "nursery"] },
        { id: "landing", name: "Landing", x: 2.63, z: 3.43, w: 1.97, d: 3.37, areas: ["landing", "stairs"], quiet: true },
        { id: "bath", name: "Bathroom", x: 2.1, z: 6.8, w: 2.5, d: 3.07, areas: ["bathroom"] },
      ],
    },
    {
      id: "second", name: "Second floor",
      rooms: [
        // the loft sits back under the roof; slope = low knee wall at the street side, ceiling rising over `run` metres
        { id: "master", name: "Master Bedroom", x: 0, z: 1.0, w: 3.37, d: 6.41,   // runs right back to the dormer windows
          slope: { knee: 0.75, run: 1.2 }, areas: ["master bedroom", "bedroom", "main bedroom"] },
        { id: "ensuite", name: "Ensuite", x: 3.37, z: 1.0, w: 1.02, d: 2.2, slope: { knee: 0.75, run: 1.2 }, areas: ["ensuite", "en-suite"], quiet: true },
        { id: "stairs2", name: "Stairs", x: 3.37, z: 3.2, w: 1.23, d: 2.64, areas: [], quiet: true },
      ],
    },
  ],
  // Devices from Edward's marked-up plan. u = across the room from its left wall (0–1),
  // v = from the room's front (street side) towards the back (0–1), as drawn on the plan.
  // kind: light (ceiling point + light pool), lamp (low light), appliance, tv, climate, camera, fan, printer, pc.
  // Each finds its Home Assistant entity from `entity`/`entities`, or else by `match` words
  // in the entity's name (first match wins; `not` words exclude).
  devices: [
    // kitchen
    { room: "kitchen", name: "Washing machine", kind: "appliance", u: 0.16, v: 0.91, match: ["washing machine", "washer"], not: ["dish"] },
    { room: "kitchen", name: "Dishwasher", kind: "appliance", u: 0.42, v: 0.9, match: ["dishwasher", "dish washer"] },
    { room: "kitchen", name: "Kitchen radiator", kind: "climate", u: 0.15, v: 0.73, match: ["kitchen radiator", "kitchen trv", "kitchen heating"] },
    { room: "kitchen", name: "Coffee machine", kind: "appliance", u: 0.12, v: 0.56, match: ["coffee"] },
    { room: "kitchen", name: "Dryer", kind: "appliance", u: 0.15, v: 0.42, match: ["dryer", "tumble"] },
    { room: "kitchen", name: "Kitchen lights", kind: "light", u: 0.52, v: 0.44, entity: "light.kitchen_top_lights" },
    { room: "kitchen", name: "Hob lights & fan", kind: "lamp", u: 0.9, v: 0.36, match: ["hob"] },
    // dining room
    { room: "dining", name: "Dining room lamp", kind: "lamp", u: 0.1, v: 0.89, match: ["dining room lamp", "dining lamp"] },
    { room: "dining", name: "Wall light", kind: "lamp", u: 0.06, v: 0.63, match: ["dining room wall", "dining wall", "wall light"], not: ["wall lights light"] },
    { room: "dining", name: "Wall light", kind: "lamp", u: 0.06, v: 0.47, match: ["dining room wall", "dining wall", "wall light"], not: ["wall lights light"], nth: 1 },
    { room: "dining", name: "Dining room light", kind: "light", u: 0.52, v: 0.47, entity: "light.dining_room_wall_lights_light" },   // the top light (named "wall lights" in HA)
    // living room
    { room: "living", name: "Doughnut lamp", kind: "lamp", u: 0.1, v: 0.85, entity: "light.dougnut_lamp", match: ["doughnut", "dougnut"] },
    { room: "living", name: "Frame TV", kind: "tv", u: 0.135, v: 0.52, y: 1.425, screen: [0.97, 0.75], entities: ["media_player.living_room_tv_qe50ls03fauxxu", "media_player.plex_plex_cast_chromecast"], plexAny: true },   // the TV + its Plex player; other Plex players that start playing show here too
    { room: "living", name: "Living room light", kind: "light", u: 0.52, v: 0.47, entity: "light.living_room_light" },
    { room: "living", name: "Candle", kind: "lamp", u: 0.09, v: 0.17, entity: "light.candle" },
    { room: "living", name: "Dyson fan", kind: "fan", u: 0.3, v: 0.08, match: ["dyson"], domains: ["fan", "climate"] },
    { room: "living", name: "Blue lamp", kind: "lamp", u: 0.29, v: -0.07, match: ["blue lamp", "baby lamp"] },
    { room: "living", name: "Nest heating", kind: "climate", u: 0.88, v: 0.14, match: ["nest", "heating", "thermostat"], not: ["garden", "office", "kitchen"], domains: ["climate"] },
    // fox's room
    { room: "fox", name: "Star projector", kind: "lamp", u: 0.13, v: 0.89, match: ["star", "projector"] },
    { room: "fox", name: "Nanit", kind: "camera", u: 0.84, v: 0.57, entity: "camera.nanit_nursery", cam: "fox_s_room" },
    { room: "hall", name: "Front door (Ring)", kind: "camera", u: 0.5, v: -0.04, match: ["front door"], domains: ["camera"], cam: "front_door" },
    // on the outside of the dining room's back wall, looking down the decked side return to just past the kitchen
    { room: "dining", name: "Garden (Ring)", kind: "camera", u: 0.3, v: 1.03, look: [0.3, 2.6], match: ["garden"], domains: ["camera"], not: ["office"], cam: "garden" },
    // on the outside of the garden office (Ring "Side"), looking back at the house
    { room: "office", name: "Shed (Ring)", kind: "camera", u: 0.5, v: -0.04, look: [0.5, -4], match: ["side", "shed"], not: ["outside"], domains: ["camera"], cam: "shed" },
    // in the dining room above the radiator, looking through to the living room
    { room: "dining", name: "Living room (Ring)", kind: "camera", u: 0.63, v: 0.96, look: [0.5, -0.9], entity: "camera.downstairs_live_view", match: ["downstairs"], domains: ["camera"], cam: "living_room" },
    { room: "fox", name: "Fox's room lights", kind: "light", u: 0.47, v: 0.45, match: ["fox"], domains: ["light", "switch"] },
    // bathroom / spare / master
    { room: "bath", name: "Bathroom lights", kind: "light", u: 0.4, v: 0.43, match: ["bathroom"], domains: ["light", "switch"] },
    { room: "spare", name: "Spare bedroom light", kind: "light", u: 0.53, v: 0.54, match: ["spare", "guest"], domains: ["light", "switch"] },
    { room: "master", name: "Master bedroom light", kind: "light", u: 0.52, v: 0.302, match: ["master bedroom", "bedroom light", "main bedroom"], not: ["bed light", "bedside", "spare", "guest", "fox"], domains: ["light", "switch"] },
    { room: "master", name: "Bedroom TV", kind: "tv", u: 0.06, v: 0.227, match: ["bedroom"], domains: ["media_player"] },
    { room: "master", name: "Bed light", kind: "lamp", u: 0.19, v: 0.053, match: ["bed light", "bedside"] },
    { room: "master", name: "Bed light", kind: "lamp", u: 0.84, v: 0.053, match: ["bed light", "bedside"], nth: 1 },
    // garden office
    { room: "office", name: "3D printer", kind: "printer", u: 0.9, v: 0.84, match: ["print status", "print_status"], domains: ["sensor"], cam: "eddo_print" },
    { room: "office", name: "Desk Hue", kind: "lamp", u: 0.9, v: 0.45, entities: ["light.deskhue", "switch.ed_skadis_plug_localbytes_plug_pm_d5f029"] },
    { room: "office", name: "Office lights", kind: "light", u: 0.49, v: 0.47, entity: "light.garden_office_lights" },
    { room: "office", name: "Shelf lights", kind: "lamp", u: 0.27, v: 0.88, match: ["shelf"], entity: "light.hue_play_gradient_lightstrip_1" },
    { room: "office", name: "AC unit", kind: "climate", u: 0.12, v: 0.99, y: 2.25, entities: ["climate.garden_office", "climate.garden_office_ac"], ac: true, mountY: 2.0 },   // wall-mounted mini split, back wall by the corner
    { room: "office", name: "Jules Skadi", kind: "lamp", u: 0.08, v: 0.5, match: ["jules"] },
    { room: "office", name: "Office lamp", kind: "lamp", u: 0.08, v: 0.27, entities: ["switch.office_lamps", "switch.office_lamp_2"] },
  ],
  // Furniture outlines, from Edward's room photos. Same u/v as devices (u from the
  // room's left wall on the plan, v from its front), h = height, y = height off the floor.
  // kind: box (default), sofa, shelves (adds shelf lines), rug (flat outline), table, chair.
  furniture: [
    // living room (photo from the dining-room end, looking at the bay)
    { room: "living", name: "Chimney breast", u0: 0, u1: 0.12, v0: 0.38, v1: 0.66, h: 2.6 },
    { room: "living", name: "Bookcase (window side)", kind: "shelves", u0: 0, u1: 0.12, v0: 0.06, v1: 0.38, h: 2.3, base: 0.8, shelves: 4 },
    { room: "living", name: "Bookcase (back)", kind: "shelves", u0: 0, u1: 0.12, v0: 0.66, v1: 0.97, h: 2.3, base: 0.8, shelves: 4 },
    { room: "living", name: "Toy cubby", kind: "shelves", u0: 0.12, u1: 0.26, v0: 0.44, v1: 0.6, h: 0.75, shelves: 1 },
    { room: "living", name: "Sofa", kind: "sofa", u0: 0.72, u1: 1, v0: 0.3, v1: 0.98, h: 0.78 },
    { room: "living", name: "Sofa chaise", kind: "sofa", u0: 0.46, u1: 1, v0: 0.07, v1: 0.31, h: 0.6, back: false },
    { room: "living", name: "Rug", kind: "rug", u0: 0.3, u1: 0.82, v0: 0.2, v1: 0.78 },
    { room: "living", name: "Floor cushions", u0: 0.12, u1: 0.27, v0: 0.78, v1: 0.93, h: 0.4 },
    // dining room (photo from the living-room end, looking at the garden window)
    { room: "dining", name: "Chimney breast", u0: 0, u1: 0.12, v0: 0.45, v1: 0.68, h: 2.6 },
    { room: "dining", name: "Built-in cupboard", u0: 0, u1: 0.12, v0: 0.06, v1: 0.45, h: 2.2 },
    { room: "dining", name: "Alcove shelves", kind: "shelves", u0: 0, u1: 0.09, v0: 0.68, v1: 0.95, y: 1.0, h: 1.1, shelves: 3 },
    { room: "dining", name: "Dining table", kind: "table", u0: 0.36, u1: 0.62, v0: 0.5, v1: 0.74, h: 0.75 },
    { room: "dining", name: "Chair", kind: "chair", u0: 0.4, u1: 0.53, v0: 0.36, v1: 0.48, h: 0.9 },
    { room: "dining", name: "Chair", kind: "chair", u0: 0.42, u1: 0.55, v0: 0.76, v1: 0.88, h: 0.9 },
    { room: "dining", name: "High chair", kind: "chair", u0: 0.64, u1: 0.76, v0: 0.52, v1: 0.66, h: 0.8 },
    { room: "dining", name: "Radiator cover", u0: 0.48, u1: 0.78, v0: 0.94, v1: 1, h: 0.9 },
    { room: "dining", name: "Bench", kind: "sofa", u0: 0.86, u1: 1, v0: 0.05, v1: 0.5, h: 0.5, back: false },
    // fox's room (photo from the door, looking at the garden window)
    { room: "fox", name: "Wardrobe", u0: 0, u1: 0.22, v0: 0.02, v1: 0.42, h: 2.3 },
    { room: "fox", name: "Chimney breast", u0: 0, u1: 0.14, v0: 0.45, v1: 0.72, h: 2.6 },
    { room: "fox", name: "Book rack", kind: "shelves", u0: 0.14, u1: 0.17, v0: 0.5, v1: 0.68, y: 0.7, h: 1.0, shelves: 4 },
    { room: "fox", name: "Alcove shelves", kind: "shelves", u0: 0, u1: 0.1, v0: 0.72, v1: 0.95, y: 1.4, h: 0.65, shelves: 2 },
    { room: "fox", name: "Nursing chair", kind: "chair", u0: 0.22, u1: 0.42, v0: 0.72, v1: 0.9, h: 0.95 },
    { room: "fox", name: "Footstool", u0: 0.26, u1: 0.42, v0: 0.56, v1: 0.68, h: 0.4 },
    { room: "fox", name: "Radiator", u0: 0.3, u1: 0.6, v0: 0.97, v1: 1, y: 0.1, h: 0.5 },
    { room: "fox", name: "Cot bed", u0: 0.7, u1: 1, v0: 0.45, v1: 0.92, h: 0.95 },
    { room: "fox", name: "Rug", kind: "rug", u0: 0.22, u1: 0.68, v0: 0.24, v1: 0.68 },
    // bathroom (photo from the door, looking at the frosted window over the bath)
    { room: "bath", name: "Vanity & basin", u0: 0, u1: 0.18, v0: 0.16, v1: 0.46, h: 0.85 },
    { room: "bath", name: "Boxed-in cistern & ledge", u0: 0, u1: 0.1, v0: 0.46, v1: 0.8, h: 1.05 },
    { room: "bath", name: "Toilet", u0: 0.1, u1: 0.25, v0: 0.55, v1: 0.71, h: 0.42 },
    { room: "bath", name: "Bath", u0: 0.18, u1: 0.64, v0: 0.77, v1: 1, h: 0.55 },
    { room: "bath", name: "Shower", u0: 0.64, u1: 1, v0: 0.69, v1: 1, h: 2.0 },
    { room: "bath", name: "Shower shelves", kind: "shelves", u0: 0.97, u1: 1, v0: 0.74, v1: 0.9, y: 1.1, h: 0.5, shelves: 2 },
    { room: "bath", name: "Boiler cupboard", u0: 0.84, u1: 1, v0: 0.02, v1: 0.42, h: 2.2 },
    // spare room (photo from the door, looking at the chimney breast; window on the left)
    { room: "spare", name: "Chimney breast", u0: 0, u1: 0.08, v0: 0.34, v1: 0.63, h: 2.6 },
    { room: "spare", name: "Desk", kind: "table", u0: 0, u1: 0.13, v0: 0.08, v1: 0.32, h: 0.76 },
    { room: "spare", name: "Desk shelves", kind: "shelves", u0: 0, u1: 0.06, v0: 0.06, v1: 0.33, y: 1.35, h: 0.85, shelves: 3 },
    { room: "spare", name: "Desk chair", kind: "chair", u0: 0.13, u1: 0.24, v0: 0.12, v1: 0.27, h: 1.15 },
    { room: "spare", name: "Chest of drawers", u0: 0, u1: 0.11, v0: 0.64, v1: 0.88, h: 0.85 },
    { room: "spare", name: "Alcove shelves", kind: "shelves", u0: 0, u1: 0.07, v0: 0.63, v1: 0.95, y: 1.1, h: 1.15, shelves: 4 },
    { room: "spare", name: "Bed", u0: 0.38, u1: 0.68, v0: 0.42, v1: 1, h: 0.55 },
    { room: "spare", name: "Brass headboard", kind: "shelves", u0: 0.38, u1: 0.68, v0: 0.97, v1: 1, h: 1.25, shelves: 2 },
    { room: "spare", name: "Radiator", u0: 0.08, u1: 0.5, v0: 0, v1: 0.03, y: 0.1, h: 0.55 },
    // hallway (photo from the front door: stairs rising ahead, radiator and wavy mirror on the right)
    { room: "hall", name: "Stairs", kind: "stairs", u0: 0.22, u1: 1, v0: 0.6, v1: 0.99, h: 2.6, steps: 13 },
    { room: "hall", name: "Radiator", u0: 0.93, u1: 1, v0: 0.12, v1: 0.42, y: 0.12, h: 0.6 },
    { room: "hall", name: "Mirror", u0: 0.985, u1: 1, v0: 0.2, v1: 0.36, y: 1.3, h: 0.7 },
    { room: "hall", name: "Dado line", kind: "rug", u0: 0.02, u1: 0.98, v0: 0.01, v1: 0.6, y: 1.05 },
    // kitchen (galley, photo from the hall end looking at the garden window)
    { room: "kitchen", name: "Fridge freezer", u0: 0.74, u1: 1, v0: 0.02, v1: 0.22, h: 1.85 },
    { room: "kitchen", name: "Worktop (hob side)", u0: 0.76, u1: 1, v0: 0.24, v1: 0.72, h: 0.9 },
    { room: "kitchen", name: "Wall units", u0: 0.84, u1: 1, v0: 0.3, v1: 0.72, y: 1.45, h: 0.75 },
    { room: "kitchen", name: "Oven tower", u0: 0.76, u1: 1, v0: 0.72, v1: 0.86, h: 2.1 },
    { room: "kitchen", name: "Worktop (window side)", u0: 0, u1: 0.24, v0: 0.14, v1: 0.62, h: 0.9 },
    { room: "kitchen", name: "Washer & dryer", u0: 0.02, u1: 0.24, v0: 0.62, v1: 0.8, h: 0.88 },
    { room: "kitchen", name: "Sink run", u0: 0, u1: 0.72, v0: 0.86, v1: 1, h: 0.9 },
    { room: "kitchen", name: "Coffee shelf", kind: "shelves", u0: 0, u1: 0.12, v0: 0.62, v1: 0.8, y: 1.3, h: 0.35, shelves: 1 },
    // master bedroom (photo from the stairs, looking at the bed under the sloping ceiling)
    { room: "master", name: "Bed", u0: 0.3, u1: 0.72, v0: 0.03, v1: 0.347, h: 0.5 },
    { room: "master", name: "Headboard", u0: 0.3, u1: 0.72, v0: 0.015, v1: 0.038, h: 0.95 },
    { room: "master", name: "Bedside crib", u0: 0.74, u1: 0.88, v0: 0.03, v1: 0.166, h: 0.85 },
    { room: "master", name: "Wardrobe", u0: 0.9, u1: 1, v0: 0.242, v1: 0.468, h: 1.95 },
    { room: "master", name: "Dressing table", kind: "table", u0: 0, u1: 0.1, v0: 0.468, v1: 0.604, h: 0.75 },
    { room: "master", name: "Chair", kind: "chair", u0: 0.08, u1: 0.2, v0: 0.589, v1: 0.68, h: 0.6 },
    // garden office (Ed's desk on one long wall, the craft desk opposite)
    { room: "office", name: "Ed's desk", kind: "table", u0: 0.8, u1: 1, v0: 0.04, v1: 0.96, h: 0.75 },
    { room: "office", name: "Pegboard", u0: 0.985, u1: 1, v0: 0.2, v1: 0.85, y: 0.95, h: 1.25 },
    { room: "office", name: "Monitors", u0: 0.88, u1: 0.93, v0: 0.3, v1: 0.72, y: 0.8, h: 0.55 },
    { room: "office", name: "PC tower", u0: 0.8, u1: 0.97, v0: 0.06, v1: 0.22, y: 0.75, h: 0.55 },
    { room: "office", name: "3D printer", u0: 0.84, u1: 0.98, v0: 0.78, v1: 0.94, y: 0.75, h: 0.45 },
    { room: "office", name: "Filament shelves", kind: "shelves", u0: 0.6, u1: 0.84, v0: 0.95, v1: 1, y: 1.0, h: 0.9, shelves: 3 },
    { room: "office", name: "Desk chair", kind: "chair", u0: 0.6, u1: 0.74, v0: 0.42, v1: 0.6, h: 1.0 },
    { room: "office", name: "Craft desk", kind: "table", u0: 0, u1: 0.18, v0: 0.04, v1: 0.96, h: 0.75 },
    { room: "office", name: "Craft pegboard", u0: 0, u1: 0.015, v0: 0.15, v1: 0.85, y: 0.95, h: 0.7 },
    { room: "office", name: "Craft drawers", u0: 0.02, u1: 0.16, v0: 0.06, v1: 0.22, h: 0.7 },
    { room: "office", name: "Craft chair", kind: "chair", u0: 0.2, u1: 0.32, v0: 0.44, v1: 0.58, h: 0.85 },
  ],
  // outbuildings sit on the ground in the garden
  outbuildings: [
    { id: "office", name: "Garden Office", x: 0.535, z: 16.865, w: 3.48, d: 2.75, h: 2.3,   // turned 90° clockwise
      roof: { ridge: "x", rise: 0.65 },   // pitched roof, ridge across the garden
      areas: ["office", "garden office", "gym"],
      entities: ["light.garden_office_lights", "light.deskhue", "light.hue_play_gradient_lightstrip_1", "switch.office_lamps", "switch.office_lamp_2"],
      climate: "climate.garden_office", scenes: ["scene.startup", "scene.shutdown"] },
  ],
};
