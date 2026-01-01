from ableton.v3.control_surface.colors import BasicColors


class Skin:
    """Simple on/off skin for EN16 LEDs."""

    class DefaultButton:
        On = BasicColors.ON
        Off = BasicColors.OFF
        Pressed = BasicColors.ON
        Disabled = BasicColors.OFF

    class Transport:
        PlayOn = BasicColors.ON
        PlayOff = BasicColors.OFF
        StopOn = BasicColors.OFF
        StopOff = BasicColors.OFF
        RecordOn = BasicColors.ON
        RecordOff = BasicColors.OFF
        LoopOn = BasicColors.ON
        LoopOff = BasicColors.OFF

    class Recording:
        ArrangementRecordOn = BasicColors.ON
        ArrangementRecordOff = BasicColors.OFF
        SessionRecordOn = BasicColors.ON
        SessionRecordOff = BasicColors.OFF

    class Mixer:
        ArmOn = BasicColors.ON
        ArmOff = BasicColors.OFF
        MuteOn = BasicColors.ON
        MuteOff = BasicColors.OFF
        SoloOn = BasicColors.ON
        SoloOff = BasicColors.OFF
        Selected = BasicColors.ON
        NotSelected = BasicColors.OFF
        NoTrack = BasicColors.OFF

    class Session:
        # Empty slot
        Slot = BasicColors.OFF
        SlotEmpty = BasicColors.OFF
        NoSlot = BasicColors.OFF

        # Clip states
        ClipStopped = BasicColors.ON
        ClipPlaying = BasicColors.ON
        ClipRecording = BasicColors.ON

        # Triggered states
        ClipTriggeredPlay = BasicColors.ON
        ClipTriggeredRecord = BasicColors.ON
        SlotTriggeredPlay = BasicColors.ON
        SlotTriggeredRecord = BasicColors.ON

        # Scene
        Scene = BasicColors.OFF
        ScenePlaying = BasicColors.ON

        # Navigation
        Navigation = BasicColors.OFF
        NavigationPressed = BasicColors.ON
