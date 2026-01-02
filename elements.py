from ableton.v3.control_surface import ElementsBase, MIDI_CC_TYPE, MIDI_NOTE_TYPE
from ableton.v3.control_surface.elements import EncoderElement
from ableton.v3.live import liveobj_valid, parameter_value_to_midi_value

NUM_TRACKS = 8
NUM_SCENES = 4


class FeedbackEncoderElement(EncoderElement):
    """Encoder that sends MIDI feedback for all parameters, not just internal ones."""

    def __init__(self, *a, **k):
        super().__init__(*a, send_should_depend_on_forwarding=False, **k)

    def reset(self):
        if liveobj_valid(self.mapped_object):
            self._parameter_value_changed()

    def _parameter_value_changed(self):
        if liveobj_valid(self.mapped_object) and not self._block_internal_parameter_feedback:
            midi_value = parameter_value_to_midi_value(self.mapped_object, max_value=self._max_value)
            if len(self._feedback_values) > midi_value:
                midi_value = self._feedback_values[midi_value]
                if isinstance(midi_value, tuple):
                    midi_value = midi_value[0] + (midi_value[1] << 7)
            self.send_value(midi_value)


def create_feedback_encoder(identifier, name, **k):
    return FeedbackEncoderElement(identifier, name=name, **k)


class Elements(ElementsBase):
    def add_encoder_matrix(self, identifiers, base_name, channels=None, *a, **k):
        self.add_matrix(
            identifiers, base_name, *a,
            channels=channels, element_factory=create_feedback_encoder, **k,
        )

    def __init__(self, *a, **k):
        super().__init__(*a, **k)

        # All 16 encoders (CC 32-47)
        self.add_encoder_matrix(
            [list(range(32, 48))],
            "Encoders",
            msg_type=MIDI_CC_TYPE,
        )

        # Device parameter encoders (first 8)
        self.add_encoder_matrix(
            [list(range(32, 40))],
            "Device_Encoders",
            msg_type=MIDI_CC_TYPE,
        )

        # Track select buttons (Note 32-39)
        self.add_button_matrix(
            [list(range(32, 40))],
            "Track_Select_Buttons",
            msg_type=MIDI_NOTE_TYPE,
        )

        # Arm buttons via long press (Note 48-55)
        self.add_button_matrix(
            [list(range(48, 56))],
            "Arm_Buttons",
            msg_type=MIDI_NOTE_TYPE,
        )

        # Clip launch buttons (Note 44-47) - 4 scenes x 1 track
        self.add_button_matrix(
            [[44], [45], [46], [47]],
            "Clip_Launch_Buttons",
            msg_type=MIDI_NOTE_TYPE,
        )

        # Control button (Note 64)
        self.add_button(
            64,
            "Control_Button",
            msg_type=MIDI_NOTE_TYPE,
        )
