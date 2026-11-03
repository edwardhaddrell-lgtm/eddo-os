import type { ActionDef } from './index.ts'
import { entityState } from './ha.ts'

export const navActions: Record<string, ActionDef> = {
    // { action: nav.page, page: living_room, entity?: climate.x }
    // With `entity`, the key also lights up while that HA entity is on.
    'nav.page': {
        run: (params, ctx) => {
            if (typeof params.page !== 'string') throw new Error('nav.page needs `page: <page name>`')
            ctx.nav.goTo(params.page)
        },
        state: params => (typeof params.entity === 'string' ? entityState(params) : undefined),
    },
    'nav.back': { run: (_params, ctx) => ctx.nav.back() },
    'nav.home': { run: (_params, ctx) => ctx.nav.home() },
}
