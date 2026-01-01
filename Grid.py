from _Framework.ControlSurface import ControlSurface
from _Framework.InputControlElement import MIDI_CC_TYPE, MIDI_NOTE_TYPE
from _Framework.EncoderElement import EncoderElement
from _Framework.ButtonElement import ButtonElement
from _Framework.DeviceComponent import DeviceComponent
from _Framework.SessionComponent import SessionComponent
from _Framework.ButtonMatrixElement import ButtonMatrixElement
from _Framework.MixerComponent import MixerComponent
from _Framework.ChannelTranslationSelector import ChannelTranslationSelector
from _Framework.ClipSlotComponent import ClipSlotComponent
from _Framework.SceneComponent import SceneComponent
import Live
import logging

logger = logging.getLogger(__name__)

def make_encoder(channel, cc, name):
    logger.info("encoder: %s %s", name, cc)
    m = Live.MidiMap.MapMode.absolute
    return EncoderElement(MIDI_CC_TYPE, channel, cc, map_mode=m, name=name)

def make_button(channel, cc, name):
    logger.info("button: %s %s", name, cc)
    return ButtonElement(True, MIDI_NOTE_TYPE, channel, cc, name=name)

def make_controls(maker, label, cc_range):
    ccs = [(index + 1, cc) for index, cc in enumerate(cc_range)]
    return [maker(0, cc, label % index) for index, cc in ccs]

class ToggleClipSlotComponent(ClipSlotComponent):
    def _do_launch_clip(self, fire_state):
        slot = self._clip_slot
        if slot and slot.has_clip and slot.clip.is_playing:
            slot.stop()
        else:
            super()._do_launch_clip(fire_state)

class ToggleSceneComponent(SceneComponent):
    clip_slot_component_type = ToggleClipSlotComponent

class ToggleSessionComponent(SessionComponent):
    scene_component_type = ToggleSceneComponent

class Grid(ControlSurface):
    def __init__(self, c_instance): # c_instance: MidiRemoteScript
        super().__init__(c_instance)
        with self.component_guard():
            self._create_controls()
            self._setup_device()
            self._setup_mixer()
            self._setup_session()
        self._set_track_controls(self._mixer.selected_strip().track)

    def _create_controls(self):
        self._encoders = make_controls(make_encoder, "Encoder_%d", range(32, 48))
        self._buttons = make_controls(make_button, "Button_%d", range(32, 48))
        self._long_buttons = make_controls(make_button, "Long_Button_%d", range(48, 64))
        self._control_button = ButtonElement(True, MIDI_NOTE_TYPE, 0, 64)
        self._control_button.add_value_listener(self._on_control)

    def _on_control(self, ev):
        logger.info("control request:%s", ev)
        self.update()

    def _setup_device(self):
        device_param_controls = []
        for i in range(8):
            device_param_controls.append(self._encoders[i])
        device = DeviceComponent()
        device.set_parameter_controls(tuple(device_param_controls))
        device_translation_selector = ChannelTranslationSelector()
        device_translation_selector.set_controls_to_translate(tuple(device_param_controls))
        self.set_device_component(device)

    def _on_selected_track_changed(self):
        logger.info("_on_selected_track_changed")
        super()._on_selected_track_changed()
        track = self.song().view.selected_track
        if self._device_component:
            device = track.view.selected_device or (track.devices[0] if track.devices else None)
            if device:
                self.song().view.select_device(device)
            self._device_component.set_device(device)
        self._set_track_controls(track)
        tracks = list(self.song().tracks)
        if track in tracks:
            self._session.set_offsets(tracks.index(track), self._session.scene_offset())

    def _setup_session(self):
        self._session = ToggleSessionComponent(num_tracks=1, num_scenes=4)
        self._session.set_offsets(0, 0)
        matrix = ButtonMatrixElement(rows=[[b] for b in self._buttons[12:16]])
        self._session.set_clip_launch_buttons(matrix)

    def _set_track_controls(self, track):
        logger.info("_set_track_controls %s", track.name)
        mixer = track.mixer_device
        
        params = [mixer.volume] + list(mixer.sends[:3])
        for i, param in enumerate(params):
            self._encoders[15 - i].release_parameter()
            self._encoders[15 - i].connect_to(param)

    def _setup_mixer(self):
        self._mixer = MixerComponent(8, 4)
        for i in range(8):
            strip = self._mixer.channel_strip(i)
            strip.set_select_button(self._buttons[i])
            strip.set_arm_button(self._long_buttons[i])
        for i in range(4):
            strip = self._mixer.return_strip(i)
            strip.set_select_button(self._buttons[8+i])
