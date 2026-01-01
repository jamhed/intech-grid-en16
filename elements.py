from ableton.v3.control_surface import ElementsBase, MIDI_CC_TYPE, MIDI_NOTE_TYPE

NUM_TRACKS = 8
NUM_SCENES = 4


class Elements(ElementsBase):
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
