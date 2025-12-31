from _Framework.ControlSurface import ControlSurface
from _Framework.InputControlElement import MIDI_CC_TYPE, MIDI_NOTE_TYPE
from _Framework.EncoderElement import EncoderElement
from _Framework.ButtonElement import ButtonElement
from _Framework.DeviceComponent import DeviceComponent
from _Framework.MixerComponent import MixerComponent
from _Framework.ChannelTranslationSelector import ChannelTranslationSelector
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

class Grid(ControlSurface):
    def __init__(self, c_instance): # c_instance: MidiRemoteScript
        super().__init__(c_instance)
        with self.component_guard():
            self._create_controls()
            self._setup_device()
            self._setup_mixer()
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
        if not self._device_component:
            return
        track = self.song().view.selected_track
        device_to_select = track.view.selected_device
        if device_to_select is None and len(track.devices) > 0:
            device_to_select = track.devices[0]
        if device_to_select is not None:
            self.song().view.select_device(device_to_select)
        self._device_component.set_device(device_to_select)
        self._set_track_controls(track)

    def _set_track_controls(self, track):
        mixer = track.mixer_device
        logger.info("_set_track_controls %s", track.name)
        self._encoders[15].release_parameter()
        self._encoders[15].connect_to(mixer.volume)
        if len(mixer.sends)==1:
            self._encoders[14].release_parameter()
            self._encoders[14].connect_to(mixer.sends[0])
        if len(mixer.sends)==2:
            self._encoders[13].release_parameter()
            self._encoders[13].connect_to(mixer.sends[1])

    def _setup_mixer(self):
        self._mixer = MixerComponent(8, 4)
        for i in range(8):
            strip = self._mixer.channel_strip(i)
            strip.set_select_button(self._buttons[i])
            strip.set_arm_button(self._long_buttons[i])
        for i in range(4):
            strip = self._mixer.return_strip(i)
            strip.set_select_button(self._buttons[8+i])
