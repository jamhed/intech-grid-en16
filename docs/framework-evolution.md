# Framework Evolution Analysis

Detailed comparison of architectural changes across Ableton's three MIDI Remote Script framework generations.

**Based on:** APC40 (\_Framework), Launchkey_MK3 (ableton.v2), APC64 (ableton.v3)

## Evolution Summary

| Aspect | _Framework | ableton.v2 | ableton.v3 |
|--------|------------|------------|------------|
| Init | Manual `component_guard()` | Base class `_create_components()` | `ControlSurfaceSpecification` |
| Elements | Helper functions | Class inheritance | Fluent DSL |
| Wiring | Inline `Layer()` | String references | `create_mappings()` |
| Events | `.add_listener()` | `@listens` decorator | `@listens` + tasks |
| Components | All manual | Framework + overrides | `component_map` |

## 1. Initialization Patterns

### \_Framework

```python
class APC40(OptimizedControlSurface):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        with self.component_guard():
            self._create_controls()
            self._create_session()
            self._create_mixer()
            self._create_device()
            self._session.set_mixer(self._mixer)
            self.set_device_component(self._device)
```

- Inherits `OptimizedControlSurface` directly
- Manual component creation and wiring
- Explicit `component_guard()` context
- Components stored as instance attributes

### ableton.v2

```python
class Launchkey_MK3(InstrumentControlMixin, NovationBase):
    element_class = Elements
    session_height = 2
    mixer_class = MixerComponent
    skin = skin

    def _create_components(self):
        super()._create_components()
        self._create_transport()
        self._create_device()
```

- Class attributes declare configuration
- Domain-specific base class (NovationBase)
- Override `_create_components()` for custom setup
- Framework handles standard initialization

### ableton.v3

```python
class Specification(ControlSurfaceSpecification):
    elements_type = Elements
    control_surface_skin = create_skin(skin=Skin, colors=Rgb)
    num_tracks = 8
    num_scenes = 8
    component_map = {
        'Mixer': MixerComponent,
        'Session': SessionComponent,
        'Transport': TransportComponent
    }

class APC64(ControlSurface):
    def __init__(self, *a, **k):
        super().__init__(Specification, *a, **k)

    def setup(self):
        super().setup()
        # Post-initialization only
```

- Specification object contains all configuration
- `component_map` declares components declaratively
- Framework instantiates everything
- `setup()` for post-initialization hooks

## 2. Element Creation

### \_Framework: Helper Functions

```python
def _create_controls(self):
    make_button = partial(ButtonElement, True, MIDI_NOTE_TYPE, 0)

    self._play_button = make_button(91, name="Play_Button")
    self._arm_buttons = [
        make_button(48 + i, name=f"{i}_Arm_Button")
        for i in range(8)
    ]
    self._arm_matrix = ButtonMatrixElement(rows=[self._arm_buttons])
```

- Functional composition with `partial()`
- Manual list comprehensions
- Explicit matrix wrapping

### ableton.v2: Class Inheritance

```python
class Elements(LaunchkeyElements):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)

        self.play_button = create_button(115, "Play_Button")
        self.arm_buttons = ButtonMatrixElement(
            rows=[[create_button(48 + i, f"Arm_{i}") for i in range(8)]],
            name="Arm_Buttons"
        )
```

- Base class provides common elements
- Elements as named attributes
- String names for layer references

### ableton.v3: Fluent DSL

```python
class Elements(ElementsBase):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)

        add_button = partial(self.add_button, msg_type=MIDI_NOTE_TYPE)
        add_matrix = partial(self.add_button_matrix, msg_type=MIDI_NOTE_TYPE)

        add_button(91, "Play_Button")
        add_matrix([range(48, 56)], "Arm_Buttons")
```

- `ElementsBase` provides DSL methods
- `add_button()`, `add_encoder()`, `add_matrix()`
- Automatic registration and naming
- Built-in submatrix support: `add_submatrix()`

## 3. Component Wiring

### \_Framework: Inline Layers

```python
def _create_mixer(self):
    self._mixer = MixerComponent(
        num_tracks=8,
        is_enabled=False,
        layer=Layer(
            volume_controls=self._volume_controls,
            arm_buttons=self._arm_buttons,
            solo_buttons=self._solo_buttons
        )
    )
```

- Layer created inline with component
- Direct element references
- Manual enable/disable management

### ableton.v2: String References

```python
def _create_mixer(self):
    self._mixer = MixerComponent(
        layer=self._create_mixer_layer()
    )

def _create_mixer_layer(self):
    return Layer(
        volume_controls="volume_controls",
        arm_buttons="arm_buttons",
        solo_buttons="solo_buttons"
    )
```

- Layer references elements by string name
- Framework looks up from Elements class
- Layers composable with `+` operator

### ableton.v3: Mapping Functions

```python
# mappings.py
def create_mappings(specification):
    return {
        'Mixer': {
            'volume_controls': 'Volume_Faders',
            'arm_buttons': 'Track_State_Buttons',
            'solo_buttons': 'Solo_Buttons'
        },
        'Session': {
            'clip_launch_buttons': 'Pads'
        }
    }
```

- Centralized mapping definition
- Component name → element name dictionary
- Framework auto-wires from specification
- Clear separation of concerns

## 4. Mode System

### \_Framework: Manual Modes

```python
def _create_modes(self):
    modes = ModesComponent(name="Encoder_Modes")

    def set_pan_mode():
        for i, enc in enumerate(self._encoders):
            self._mixer.channel_strip(i).set_pan_control(enc)

    def set_send_mode(send_index):
        for i, enc in enumerate(self._encoders):
            sends = [None] * 3
            sends[send_index] = enc
            self._mixer.channel_strip(i).set_send_controls(sends)

    modes.add_mode("pan", [set_pan_mode])
    modes.add_mode("send_a", [partial(set_send_mode, 0)])
    modes.layer = Layer(
        pan_button=self._pan_button,
        send_a_button=self._send_a_button
    )
```

- Modes are lists of callables
- Manual component manipulation
- Direct function references

### ableton.v2: AddLayerMode

```python
def _create_modes(self):
    modes = ModesComponent(name="Encoder_Modes")

    modes.add_mode("pan", AddLayerMode(
        self._mixer,
        Layer(pan_controls="encoders")
    ))
    modes.add_mode("sends", AddLayerMode(
        self._mixer,
        Layer(send_controls="encoders")
    ))
    modes.layer = Layer(
        pan_button="pan_button",
        sends_button="sends_button"
    )
```

- `AddLayerMode(component, layer)` combines enable + bind
- `DelayMode` for timed transitions
- Cleaner than raw callables

### ableton.v3: Selector + Tasks

```python
class PadModes(ModesComponent):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)

        self.add_mode("session", AddLayerMode(
            self._session, self._session_layer))
        self.add_mode("drum", AddLayerMode(
            self._drum, self._drum_layer))

    @listens("selected_mode")
    def __on_mode_changed(self, mode):
        self._tasks.add(task.run(self._update_leds))
```

- `@listens` for reactive mode changes
- Task integration for async updates
- Better observer pattern support

## 5. Event Handling

### \_Framework: Direct Listeners

```python
def _create_controls(self):
    self._play_button = make_button(91)
    self._play_button.add_value_listener(self._on_play_value)

def _on_play_value(self, value):
    if value:
        self.song().start_playing()

def disconnect(self):
    self._play_button.remove_value_listener(self._on_play_value)
    super().disconnect()
```

- Manual `add_value_listener()` / `remove_value_listener()`
- Must track and clean up listeners
- Error-prone lifecycle management

### ableton.v2: @listens Decorator

```python
from ableton.v2.base import listens

class MyComponent(Component):
    def set_device(self, device):
        self._device = device
        self.__on_name_changed.subject = device

    @listens('name')
    def __on_name_changed(self):
        self.notify_device_name(self._device.name)
```

- Decorator creates listener infrastructure
- `.subject` property for binding
- Automatic cleanup on disconnect
- Name-mangled for privacy (`__on_*`)

### ableton.v3: Enhanced Listeners

```python
from ableton.v3.base import listens

class DeviceComponent(DeviceComponentBase):
    @listens("visible_macro_count")
    def __on_macro_count_changed(self):
        self._update_parameters()

    @listens("macros_mapped")
    def __on_macros_mapped(self):
        self._update_parameters()

    def _set_device(self, device):
        self.__on_macro_count_changed.subject = device if is_rack(device) else None
        self.__on_macros_mapped.subject = device if is_rack(device) else None
```

- Same decorator syntax as v2
- Conditional subject binding
- Better integration with component lifecycle
- Task system for deferred updates

## 6. Side-by-Side Comparison

### Creating a Transport Component

**_Framework:**

```python
# Create elements
self._play = ButtonElement(True, MIDI_NOTE_TYPE, 0, 91, name="Play")
self._stop = ButtonElement(True, MIDI_NOTE_TYPE, 0, 92, name="Stop")

# Create and wire component
self._transport = TransportComponent(
    is_enabled=False,
    layer=Layer(
        play_button=self._play,
        stop_button=self._stop
    )
)
self._transport.set_enabled(True)
```

**ableton.v2:**

```python
# Elements class
class Elements(ElementsBase):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.play_button = create_button(91, "Play_Button")
        self.stop_button = create_button(92, "Stop_Button")

# Component creation
def _create_transport(self):
    self._transport = TransportComponent(
        layer=Layer(
            play_button="play_button",
            stop_button="stop_button"
        )
    )
```

**ableton.v3:**

```python
# Elements
class Elements(ElementsBase):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.add_button(91, "Play_Button", msg_type=MIDI_NOTE_TYPE)
        self.add_button(92, "Stop_Button", msg_type=MIDI_NOTE_TYPE)

# Specification
class Specification(ControlSurfaceSpecification):
    elements_type = Elements
    component_map = {'Transport': TransportComponent}

# Mappings
def create_mappings(spec):
    return {
        'Transport': {
            'play_button': 'Play_Button',
            'stop_button': 'Stop_Button'
        }
    }
```

## 7. Migration Considerations

### \_Framework → ableton.v2

1. Move element creation to `Elements` class
2. Replace direct element refs with string names in layers
3. Add `@listens` decorators for event handling
4. Use `AddLayerMode` instead of callable lists
5. Extend appropriate base class (NovationBase, etc.)

### ableton.v2 → ableton.v3

1. Create `ControlSurfaceSpecification` class
2. Move component types to `component_map`
3. Replace `Elements` inheritance with `ElementsBase` DSL
4. Create `create_mappings()` function
5. Access components via `self.component_map["Name"]`
6. Move post-init logic to `setup()` method

## 8. Controller Additions by Version

Based on comparison of decompiled scripts from Live 9, 10, 11, and 12:

### Live 9 → 10 (+19 controllers)

New v2 controllers: Akai_Force_MPC, ATOM, ATOMSQ, BLOCKS, Code_Series, CTRL49,
iRig_Keys_IO, KeyLab_Essential, KeyLab_mkII, Komplete_Kontrol_A,
Komplete_Kontrol_S_Mk2, Launchkey_Mini_MK3, Launchpad_Mini_MK3,
Launchpad_Pro_MK3, Launchpad_X, MaxForLive, MiniLab_mkII, Roland_FA, SL_MkIII

### Live 10 → 11 (+17 controllers)

New controllers including first v3: APC_Key_25_mk2, APC_mini_mk2,
Blackstar_Live_Logic, Faderport, Faderport_16, Faderport_8, FANTOM,
Hammer_88_Pro, Launchkey_MK3, MiniLab_3, MPK_mini_mkI, MPK_mini_mkII,
MPK_mini_mkIII, Oxygen_5th_Gen, Oxygen_Pro, Oxygen_Pro_Mini

### Live 11 → 12 (+3 controllers)

New v3 controllers: APC64, KeyLab_Essential_mk3, Keystage, Komplete_Kontrol_S_Mk3

## See Also

- [Framework Versions](ableton-framework-versions.md) - Version history and detection
- [Control Surface Architecture](control-surface.md) - _Framework deep dive
