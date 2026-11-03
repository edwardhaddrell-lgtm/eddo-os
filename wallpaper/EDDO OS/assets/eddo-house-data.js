// EDDO OS · House model (from the Shortland Gardens floor plan).
// Metres. x = across the house from the left wall as drawn on the plan,
// z = from the front of the house (street) towards the garden.
// Each room lights up from the Home Assistant area whose name matches one of
// its `areas` (case-insensitive), plus any `entities` listed directly.
// Edit freely: sizes, the garden gap, names, area names.
window.EDDO_HOUSE = {
  name: "Shortland Gardens",
  floorHeight: 2.6,
  floorGap: 1.3,                 // extra space between floors so each level reads clearly
  floors: [
    {
      id: "ground", name: "Ground floor",
      rooms: [
        { id: "living", name: "Living Room", x: 0, z: 0, w: 3.4, d: 4.04, bay: true,
          areas: ["living room", "lounge", "reception"],
          entities: ["light.living_room", "light.living_room_light", "light.candle", "light.dougnut_lamp"] },
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
  // outbuildings sit on the ground in the garden
  outbuildings: [
    { id: "office", name: "Garden Office", x: 0.9, z: 16.5, w: 2.75, d: 3.48, h: 2.4,
      areas: ["office", "garden office", "gym"],
      entities: ["light.garden_office_lights", "light.deskhue", "light.hue_play_gradient_lightstrip_1", "switch.office_lamps", "switch.office_lamp_2"],
      climate: "climate.garden_office" },
  ],
};
