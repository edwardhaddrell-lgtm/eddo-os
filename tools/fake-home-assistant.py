import asyncio, json, websockets
AREAS=[{"area_id":"office","name":"Office"},{"area_id":"kitchen","name":"Kitchen"}]
DEVS=[{"id":"d1","area_id":"office","name":"Office Lights","name_by_user":None},{"id":"d2","area_id":"kitchen","name":"Sage Barista","name_by_user":None},{"id":"d3","area_id":"office","name":"Office Heater","name_by_user":None}]
ENTS=[{"entity_id":"light.office_ceiling","device_id":"d1","area_id":None,"hidden_by":None,"disabled_by":None,"entity_category":None},
 {"entity_id":"light.office_desk_lamp","device_id":None,"area_id":"office","hidden_by":None,"disabled_by":None,"entity_category":None},
 {"entity_id":"climate.office","device_id":"d3","area_id":None,"hidden_by":None,"disabled_by":None,"entity_category":None},
 {"entity_id":"sensor.office_temperature","device_id":None,"area_id":"office","hidden_by":None,"disabled_by":None,"entity_category":None},
 {"entity_id":"sensor.office_signal","device_id":"d1","area_id":None,"hidden_by":None,"disabled_by":None,"entity_category":"diagnostic"},
 {"entity_id":"switch.coffee_machine","device_id":"d2","area_id":None,"hidden_by":None,"disabled_by":None,"entity_category":None},
 {"entity_id":"light.kitchen","device_id":None,"area_id":"kitchen","hidden_by":None,"disabled_by":None,"entity_category":None}]
ST={"scene.startup":("2026-10-29",{"friendly_name":"Startup"}),"scene.shutdown":("2026-10-28",{"friendly_name":"Shutdown"}),
 "climate.garden_office":("heat",{"friendly_name":"Garden Office","current_temperature":18.5,"temperature":21,"target_temp_step":0.5,"hvac_modes":["off","heat","cool","heat_cool","dry","fan_only"]}),
 "light.garden_office_lights":("on",{"friendly_name":"Garden office lights","brightness":230,"supported_color_modes":["brightness"],"color_mode":"brightness"}),
 "light.deskhue":("on",{"friendly_name":"DeskHue","brightness":128,"supported_color_modes":["color_temp","xy"],"color_mode":"xy","hs_color":[200,70],"min_color_temp_kelvin":2200,"max_color_temp_kelvin":6500}),
 "light.hue_play_gradient_lightstrip_1":("off",{"friendly_name":"strip"}),
 "switch.office_lamps":("on",{"friendly_name":"Office lamps"}),
 "switch.ed_skadis_plug_localbytes_plug_pm_d5f029":("off",{"friendly_name":"ed"}),
 "switch.office_lamp_2":("off",{"friendly_name":"jules"}),
 "switch.office_draw_light_socket_1":("on",{"friendly_name":"socket"}),"light.office_ceiling":("on",{"friendly_name":"Office Ceiling","brightness":200}),
 "light.office_desk_lamp":("off",{"friendly_name":"Office Desk Lamp"}),
 "climate.office":("heat",{"friendly_name":"Office Heater","current_temperature":19.5,"temperature":21,"target_temp_step":0.5}),
 "sensor.office_temperature":("19.46",{"friendly_name":"Office Temperature","unit_of_measurement":"°C"}),
 "sensor.office_signal":("-60",{"friendly_name":"sig"}),
 "switch.coffee_machine":("off",{"friendly_name":"Coffee Machine"}),
 "light.kitchen":("on",{"friendly_name":"Kitchen"}),
 "todo.shopping_list":("2",{"friendly_name":"Shopping list"}),"todo.top_3":("3",{"friendly_name":"Top 3"}),"calendar.haddrellwood_gmail_com":("off",{"friendly_name":"haddrellwood@gmail.com","message":"Dentist - Fox","start_time":"2026-11-03 09:30:00","all_day":False})}
TODO=[{"uid":"a","summary":"Order coffee beans","status":"needs_action"},{"uid":"b","summary":"Print cartridge labels","status":"needs_action"},{"uid":"c","summary":"Book Frame TV wall mount","status":"completed"},{"uid":"d","summary":"Finish Loupedeck HA page","status":"needs_action"}]
async def h(ws):
    await ws.send(json.dumps({"type":"auth_required"}))
    a=json.loads(await ws.recv()); print('auth',a)
    await ws.send(json.dumps({"type":"auth_ok"}))
    async for raw in ws:
        m=json.loads(raw); t=m["type"]; i=m["id"]; print('<-',t, m.get('entity_ids') or m.get('entity_id') or m.get('domain'), m.get('service'))
        r=lambda res: ws.send(json.dumps({"id":i,"type":"result","success":True,"result":res}))
        if t=="config/area_registry/list": await r(AREAS)
        elif t=="config/device_registry/list": await r(DEVS)
        elif t=="config/entity_registry/list": await r(ENTS)
        elif t=="get_states": await r([{"entity_id":k,"state":v[0],"attributes":v[1]} for k,v in ST.items()])
        elif t=="subscribe_entities":
            await r(None); await ws.send(json.dumps({"id":i,"type":"event","event":{"a":{k:{"s":ST[k][0],"a":ST[k][1]} for k in m["entity_ids"]}}}))
        elif t=="todo/item/subscribe":
            await r(None); await ws.send(json.dumps({"id":i,"type":"event","event":{"items":TODO}}))
        else: await r({})
async def main():
    async with websockets.serve(h,"127.0.0.1",8123): await asyncio.Future()
asyncio.run(main())
