// EDDO OS · House model (from the Shortland Gardens floor plan).
// Metres. x = across the house from the left wall as drawn on the plan,
// z = from the front of the house (street) towards the garden.
// Each room lights up from the Home Assistant area whose name matches one of
// its `areas` (case-insensitive), plus any `entities` listed directly.
// Edit freely: sizes, the garden gap, names, area names.
window.EDDO_HOUSE = {
  name: "Shortland Gardens",
  site: { lat: 51.4057, lon: 0.0158, northDeg: 45 },   // plan north points up-right (45° clockwise from the plan's "up")
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
      id: "first", name: "First floor",
      rooms: [
        { id: "spare", name: "Spare Room", x: 0, z: 0, w: 4.6, d: 3.43, areas: ["spare room", "guest room", "bedroom 2"] },
        { id: "fox", name: "Fox's Room", x: 0, z: 3.43, w: 2.63, d: 3.37, areas: ["fox's room", "fox room", "foxs room", "nursery"] },
        { id: "landing", name: "Landing", x: 2.63, z: 3.43, w: 1.97, d: 3.37, areas: ["landing", "stairs"], quiet: true },
        { id: "bath", name: "Bathroom", x: 2.1, z: 6.8, w: 2.5, d: 3.07, areas: ["bathroom"] },
      ],
    },
    {
      id: "second", name: "Second floor",
      rooms: [
        { id: "master", name: "Master Bedroom", x: 0, z: 0, w: 3.37, d: 4.84, areas: ["master bedroom", "bedroom", "main bedroom"] },
        { id: "ensuite", name: "Ensuite", x: 3.37, z: 0, w: 1.02, d: 2.2, areas: ["ensuite", "en-suite"], quiet: true },
        { id: "stairs2", name: "Stairs", x: 3.37, z: 2.2, w: 1.23, d: 2.64, areas: [], quiet: true },
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
    { room: "dining", name: "Wall light", kind: "lamp", u: 0.06, v: 0.63, match: ["dining room wall", "dining wall", "wall light"] },
    { room: "dining", name: "Wall light", kind: "lamp", u: 0.06, v: 0.47, match: ["dining room wall", "dining wall", "wall light"], nth: 1 },
    { room: "dining", name: "Dining room light", kind: "light", u: 0.52, v: 0.47, match: ["dining room light", "dining light"], not: ["lamp", "wall"] },
    // living room
    { room: "living", name: "Doughnut lamp", kind: "lamp", u: 0.1, v: 0.85, entity: "light.dougnut_lamp", match: ["doughnut", "dougnut"] },
    { room: "living", name: "Frame TV", kind: "tv", u: 0.05, v: 0.52, match: ["frame"], domains: ["media_player"] },
    { room: "living", name: "Living room light", kind: "light", u: 0.52, v: 0.47, entity: "light.living_room_light" },
    { room: "living", name: "Candle", kind: "lamp", u: 0.09, v: 0.17, entity: "light.candle" },
    { room: "living", name: "Dyson fan", kind: "fan", u: 0.3, v: 0.08, match: ["dyson"], domains: ["fan", "climate"] },
    { room: "living", name: "Blue lamp", kind: "lamp", u: 0.29, v: -0.07, match: ["blue lamp", "baby lamp"] },
    { room: "living", name: "Nest heating", kind: "climate", u: 0.88, v: 0.14, match: ["nest", "heating", "thermostat"], not: ["garden", "office", "kitchen"], domains: ["climate"] },
    // fox's room
    { room: "fox", name: "Star projector", kind: "lamp", u: 0.13, v: 0.89, match: ["star", "projector"] },
    { room: "fox", name: "Nanit", kind: "camera", u: 0.84, v: 0.57, entity: "camera.nanit_nursery", cam: "fox_s_room" },
    { room: "hall", name: "Front door (Ring)", kind: "camera", u: 0.5, v: -0.04, match: ["front door"], domains: ["camera"], cam: "front_door" },
    { room: "kitchen", name: "Garden (Ring)", kind: "camera", u: 0.5, v: 1.03, match: ["garden"], domains: ["camera"], not: ["office"], cam: "garden" },
    { room: "fox", name: "Fox's room lights", kind: "light", u: 0.47, v: 0.45, match: ["fox"], domains: ["light", "switch"] },
    // bathroom / spare / master
    { room: "bath", name: "Bathroom lights", kind: "light", u: 0.4, v: 0.43, match: ["bathroom"], domains: ["light", "switch"] },
    { room: "spare", name: "Spare bedroom light", kind: "light", u: 0.53, v: 0.54, match: ["spare", "guest"], domains: ["light", "switch"] },
    { room: "master", name: "Master bedroom light", kind: "light", u: 0.52, v: 0.4, match: ["master bedroom", "bedroom light", "main bedroom"], not: ["bed light", "bedside", "spare", "guest", "fox"], domains: ["light", "switch"] },
    { room: "master", name: "Bedroom TV", kind: "tv", u: 0.06, v: 0.3, match: ["bedroom"], domains: ["media_player"] },
    { room: "master", name: "Bed light", kind: "lamp", u: 0.19, v: 0.07, match: ["bed light", "bedside"] },
    { room: "master", name: "Bed light", kind: "lamp", u: 0.84, v: 0.07, match: ["bed light", "bedside"], nth: 1 },
    // garden office
    { room: "office", name: "3D printer", kind: "printer", u: 0.16, v: 0.9, match: ["print status", "print_status"], domains: ["sensor"], cam: "eddo_print" },
    { room: "office", name: "Desk Hue · Ed Skadi · monitor", kind: "lamp", u: 0.55, v: 0.9, entities: ["light.deskhue", "switch.ed_skadis_plug_localbytes_plug_pm_d5f029"] },
    { room: "office", name: "Ed PC · Unraid", kind: "pc", u: 0.85, v: 0.87 },
    { room: "office", name: "Office lights", kind: "light", u: 0.53, v: 0.49, entity: "light.garden_office_lights" },
    { room: "office", name: "Shelf lights", kind: "lamp", u: 0.12, v: 0.27, match: ["shelf"], entity: "light.hue_play_gradient_lightstrip_1" },
    { room: "office", name: "AC unit", kind: "climate", u: 0.14, v: 0.08, entity: "climate.garden_office" },
    { room: "office", name: "Jules Skadi", kind: "lamp", u: 0.5, v: 0.08, match: ["jules"] },
    { room: "office", name: "Office lamp", kind: "lamp", u: 0.73, v: 0.08, entities: ["switch.office_lamps", "switch.office_lamp_2"] },
  ],
  // Furniture outlines, from Edward's room photos. Same u/v as devices (u from the
  // room's left wall on the plan, v from its front), h = height, y = height off the floor.
  // kind: box (default), sofa, shelves (adds shelf lines), rug (flat outline), table, chair.
  furniture: [
    // living room (photo from the dining-room end, looking at the bay)
    { room: "living", name: "Chimney breast", u0: 0, u1: 0.12, v0: 0.38, v1: 0.66, h: 2.6 },
    { room: "living", name: "Frame TV", u0: 0.12, u1: 0.14, v0: 0.4, v1: 0.64, y: 1.05, h: 0.75 },
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
  ],
  // outbuildings sit on the ground in the garden
  outbuildings: [
    { id: "office", name: "Garden Office", x: 0.9, z: 16.5, w: 2.75, d: 3.48, h: 2.4,
      areas: ["office", "garden office", "gym"],
      entities: ["light.garden_office_lights", "light.deskhue", "light.hue_play_gradient_lightstrip_1", "switch.office_lamps", "switch.office_lamp_2"],
      climate: "climate.garden_office", scenes: ["scene.startup", "scene.shutdown"] },
  ],
};
