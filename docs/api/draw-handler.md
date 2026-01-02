# `draw_handler` (short: `ld`)

The handler receives `self` as its implicit parameter (object-oriented style). This handler is part of the LCD element and is triggered repeatedly to update the screen display.

## Available Methods via `self`

### LCD-specific parameters

| Short | Human Name | Description |
|-------|-----------|-------------|
| `ind` | `element_index` | Element index |
| `lin` | `screen_index` | Screen index used by low-level APIs |
| `lsw` | `screen_width` | Screen width in pixels |
| `lsh` | `screen_height` | Screen height in pixels |

### Drawing functions

| Short | Human Name | Usage |
|-------|-----------|-------|
| `ldsw` | `draw_swap` | `self:ldsw()` - Updates screen with background buffer |
| `ldpx` | `draw_pixel` | `self:ldpx(x, y, {r, g, b})` - Draw pixel |
| `ldl` | `draw_line` | `self:ldl(x1, y1, x2, y2, {r, g, b})` - Draw line |
| `ldr` | `draw_rectangle` | `self:ldr(x1, y1, x2, y2, {r, g, b})` - Draw rectangle |
| `ldrf` | `draw_rectangle_filled` | `self:ldrf(x1, y1, x2, y2, {r, g, b})` - Draw filled rectangle |
| `ldrr` | `draw_rectangle_rounded` | `self:ldrr(x1, y1, x2, y2, radius, {r, g, b})` - Draw rounded rectangle |
| `ldrrf` | `draw_rectangle_rounded_filled` | `self:ldrrf(x1, y1, x2, y2, radius, {r, g, b})` - Draw filled rounded rectangle |
| `ldpo` | `draw_polygon` | `self:ldpo({x1, x2, ...}, {y1, y2, ...}, {r, g, b})` - Draw polygon |
| `ldpof` | `draw_polygon_filled` | `self:ldpof({x1, x2, ...}, {y1, y2, ...}, {r, g, b})` - Draw filled polygon |
| `ldt` | `draw_text` | `self:ldt('text', x, y, size, {r, g, b})` - Draw text |
| `ldft` | `draw_text_fast` | `self:ldft('text', x, y, size, {r, g, b})` - Draw text (fast) |
| `ldaf` | `draw_area_filled` | `self:ldaf(x1, y1, x2, y2, {r, g, b})` - Fill area (no alpha) |
| `ldd` | `draw_demo` | `self:ldd(n)` - Draw n-th demo iteration |

### General functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `gen` | `element_name` | Get element name |
| `gsen` | `element_name_set` | Set element name |
| `glsb` | `lcd_set_backlight` | Set LCD backlight level |

## Default Action String

The default draw handler implements a value display with rounded rectangles:

```lua
if self.f>0 then
  self.f=self.f-1
  local a,xo=gmaps(self.v[1],self.v[2],self.v[3],0.1,1),#tostring(self.v[1])/2*s/2-#tostring(self.v[1])-s//32
  self:ldaf(10,10,310,230,c[1])
  self:ldrr(xc-p//1-1,yc-p//1-1,xc+p//1+1,yc+p//1+1,s,c[2])
  self:ldrrf(xc-p*a//1,yc-p*a//1,xc+p*a//1,yc+p*a//1,s,c[3])
  self:ldft(self.v[1],xc-xo,yc+s,s/2,c[2])
  local xn=(#self.id*(s/2))/2-s//32
  self:ldft(self.id,xc-xn,yc-1.5*s,s/2,c[2])
  self:ldsw()
end
```

This draws a visual representation of a value with element name label, updating only when the frame flag `self.f` is set.

---
[← Back to Reference](../grid-lua.md)
