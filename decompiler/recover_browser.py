#!/usr/bin/env python3
"""Recover BrowserComponent class from bytecode."""

from llm_recovery import CLASS_RECOVERY_PROMPT, call_claude, extract_code_from_response
import textwrap

def recover_browser_component():
    """Recover BrowserComponent class."""

    incomplete_source = "class BrowserComponent(object):\n    pass"

    bytecode = """Object Name: BrowserComponent
            Qualified Name: BrowserComponent
            Arg Count: 0
            Pos Only Arg Count: 0
            KW Only Arg Count: 0
            Stack Size: 5
            Flags: 0x00000000
            [Names]
                '__name__'
                '__module__'
                '__qualname__'
                '__events__'
                'NUM_ITEMS_PER_COLUMN'
                'NUM_VISIBLE_BROWSER_LISTS'
                'NUM_COLUMNS_IN_EXPANDED_LIST'
                'EXPAND_LIST_TIME'
                'REVEAL_PREVIEW_LIST_TIME'
                'MIN_TIME'
                'MAX_TIME'
                'MIN_TIME_TEXT_LENGTH'
                'MAX_TIME_TEXT_LENGTH'
                'ButtonControl'
                'up_button'
                'down_button'
                'NAVIGATION_COLORS'
                'right_button'
                'left_button'
                'back_button'
                'open_button'
                'load_button'
                'close_button'
                'ToggleButtonControl'
                'prehear_button'
                'control_list'
                'StepEncoderControl'
                'scroll_encoders'
                'scroll_focused_encoder'
                'listenable_property'
                'managed'
                'scrolling'
                'horizontal_navigation'
                'list_offset'
                'can_enter'
                'can_exit'
                'context_color_index'
                'context_text'
                'depends'
                'dict'
                '__init__'
                'pressed'
                'released'
                'touched'
                'value'
                '_on_encoder_value'
                '_on_encoder_touched'
                '_on_encoder_released'
                '_get_list_index_for_encoder'
                'toggled'
                'lists'
                'focused_list_index'
                'prehear_enabled'
                'property'
                'focused_list'
                'focused_item'
                'expanded'
                'load_neighbour_overlay'
                'should_widen_focused_item'
                'context_display_type'
                'disconnect'
                'setter'
                'listens'
                '_on_selected_track_color_index_changed'
                '_on_selected_track_name_changed'
                '_on_detail_clip_name_changed'
                '_on_hotswap_target_changed'
                '_on_focused_item_changed'
                'browse_for_audio_clip'
                '_switched_to_empty_pad'
                '_focus_list_with_index'
                '_on_focused_selection_changed'
                '_get_actual_item'
                '_previous_can_be_loaded'
                '_next_can_be_loaded'
                '_on_load_next'
                '_on_load_previous'
                '_update_load_neighbour_overlay_visibility'
                '_load_selected_item'
                '_show_load_notification'
                '_make_notification_text'
                '_load_item'
                'contextmanager'
                '_insert_right_of_selected'
                '_prehear_selected_item'
                '_stop_prehear'
                '_update_navigation_buttons'
                '_update_scrolling'
                '_update_horizontal_navigation'
                '_update_context'
                '_enter_selected_item'
                '_exit_selected_item'
                '_can_auto_expand'
                '_update_auto_expand'
                '_update_list_offset'
                '_replace_preview_list_by_task'
                '_finish_preview_list_task'
                '_replace_preview_list'
                '_append_browser_list'
                '_crop_browser_lists'
                '_make_root_browser_items'
                '_content_cache_is_valid'
                '_invalidate_content_cache'
                '_update_content_cache'
                '_update_root"""

    methods = "NUM_ITEMS_PER_COLUMN, NUM_VISIBLE_BROWSER_LISTS, NUM_COLUMNS_IN_EXPANDED_LIST, EXPAND_LIST_TIME, REVEAL_PREVIEW_LIST_TIME, MIN_TIME, MAX_TIME, MIN_TIME_TEXT_LENGTH, MAX_TIME_TEXT_LENGTH, ButtonControl, up_button, down_button, NAVIGATION_COLORS, right_button, left_button, back_button, open_button, load_button, close_button, ToggleButtonControl, prehear_button, control_list, StepEncoderControl, scroll_encoders, scroll_focused_encoder, listenable_property, managed, scrolling, horizontal_navigation, list_offset, can_enter, can_exit, context_color_index, context_text, depends, dict, __init__, pressed, released, touched, value, _on_encoder_value, _on_encoder_touched, _on_encoder_released, _get_list_index_for_encoder, toggled, lists, focused_list_index, prehear_enabled, property, focused_list, focused_item, expanded, load_neighbour_overlay, should_widen_focused_item, context_display_type, disconnect, setter, listens, _on_selected_track_color_index_changed, _on_selected_track_name_changed, _on_detail_clip_name_changed, _on_hotswap_target_changed, _on_focused_item_changed, browse_for_audio_clip, _switched_to_empty_pad, _focus_list_with_index, _on_focused_selection_changed, _get_actual_item, _previous_can_be_loaded, _next_can_be_loaded, _on_load_next, _on_load_previous, _update_load_neighbour_overlay_visibility, _load_selected_item, _show_load_notification, _make_notification_text, _load_item, contextmanager, _insert_right_of_selected, _prehear_selected_item, _stop_prehear, _update_navigation_buttons, _update_scrolling, _update_horizontal_navigation, _update_context, _enter_selected_item, _exit_selected_item, _can_auto_expand, _update_auto_expand, _update_list_offset, _replace_preview_list_by_task, _finish_preview_list_task, _replace_preview_list, _append_browser_list, _crop_browser_lists, _make_root_browser_items, _content_cache_is_valid, _invalidate_content_cache, _update_content_cache, _update_root_items, _select_hotswap_target, num_preview_items, update, _wrap_item, _wrap_device_item, _is_hotswap_target_plugin, _wrap_hotswapped_plugin_item"

    context = """from past.utils import old_div
from contextlib import contextmanager
from math import ceil
import Live
from ableton.v2.base import BooleanContext, depends, index_if, lazy_attribute, listenable_property, listens, liveobj_changed, liveobj_valid, nop, task
from ableton.v2.control_surface import Component
from ableton.v2.control_surface.control import ButtonControl, StepEncoderControl, ToggleButtonControl, control_list
from pushbase.browser_util import filter_type_for_hotswap_target, get_selection_for_new_device
from pushbase.consts import MessageBoxText
from pushbase.message_box_component import Messenger
from browser_item import BrowserItem, ProxyBrowserItem
from browser_list import BrowserList
from colors import DISPLAY_BUTTON_SHADE_LEVEL, IndexedColor"""

    prompt = CLASS_RECOVERY_PROMPT.format(
        incomplete_source=incomplete_source,
        bytecode=bytecode[:4000],
        methods=methods,
        context=context,
    )

    print("Calling claude to recover BrowserComponent...")
    response = call_claude(prompt)

    if response:
        code = extract_code_from_response(response)
        if code:
            print("Successfully recovered BrowserComponent:")
            print(code)
            return code
        else:
            print("Failed to extract code from response")
    else:
        print("Failed to get response from claude")

    return None

if __name__ == "__main__":
    recover_browser_component()