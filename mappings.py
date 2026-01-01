def create_mappings(control_surface):
    mappings = {}

    # Device control: first 8 encoders control device parameters
    mappings["Device"] = dict(
        parameter_controls="device_encoders",
    )

    # Mixer: track select and arm buttons
    mappings["Mixer"] = dict(
        track_select_buttons="track_select_buttons",
        arm_buttons="arm_buttons",
    )

    # Session: clip launch (1 track x 4 scenes)
    mappings["Session"] = dict(
        clip_launch_buttons="clip_launch_buttons",
    )

    # Target track controls: volume + 3 sends on encoders 12-15
    mappings["Target_Track_Controls"] = dict(
        volume_control="encoders_raw[15]",
        send_a_control="encoders_raw[14]",
        send_b_control="encoders_raw[13]",
        send_c_control="encoders_raw[12]",
    )

    # View-based target track following
    mappings["View_Based_Recording"] = dict()
    mappings["Target_Track"] = dict()

    return mappings
