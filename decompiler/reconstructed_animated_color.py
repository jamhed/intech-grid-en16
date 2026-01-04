"""
Reconstructed AnimatedColor class based on bytecode analysis.

This class appears to be part of Ableton Live's control surface framework,
specifically for handling animated color transitions on MIDI controllers.
"""

from past.utils import old_div
from itertools import repeat
from ableton.v2.control_surface.elements import Color, to_midi_value


class AnimatedColor(object):
    """
    An animated color class for Ableton Live control surfaces.

    This class handles color animations and MIDI value conversion for
    control surface elements that support dynamic color changes.
    """

    class RgbColor(object):
        """
        Nested RGB color representation.
        """
        def __init__(self, red, green, blue):
            self.red = red
            self.green = green
            self.blue = blue

        def to_tuple(self):
            return (self.red, self.green, self.blue)

    def __init__(self, color=None, animation_steps=None, animation_duration=1.0):
        """
        Initialize the AnimatedColor.

        Args:
            color: Base color (Color object or RGB tuple)
            animation_steps: Number of steps in animation
            animation_duration: Duration of animation in seconds
        """
        self._base_color = color or Color(0)
        self._animation_steps = animation_steps or 16
        self._animation_duration = animation_duration
        self._current_step = 0
        self._midi_value_cache = None
        self._rgb_color = None

        # Initialize RGB color representation
        if hasattr(color, 'rgb'):
            self._rgb_color = self.RgbColor(*color.rgb)
        elif isinstance(color, (tuple, list)) and len(color) >= 3:
            self._rgb_color = self.RgbColor(*color[:3])
        else:
            self._rgb_color = self.RgbColor(0, 0, 0)

    @property
    def midi_value(self):
        """
        Get the current MIDI value for this color.

        Returns:
            int: MIDI value (0-127) representing current color state
        """
        if self._midi_value_cache is None:
            self._midi_value_cache = self.convert_to_midi_value()
        return self._midi_value_cache

    @property
    def RgbColor(self):
        """
        Get the RGB color representation.

        Returns:
            RgbColor: Current RGB color object
        """
        return self._rgb_color

    def can_draw_on_interface(self):
        """
        Check if this color can be drawn on the control surface interface.

        Returns:
            bool: True if the color can be drawn, False otherwise
        """
        # Check if we have valid color data and the interface supports it
        if self._base_color is None:
            return False

        # Check if MIDI value is within valid range
        midi_val = self.midi_value
        return 0 <= midi_val <= 127

    def draw(self, element=None, interface=None):
        """
        Draw the current color state on the specified element/interface.

        Args:
            element: Control surface element to draw on
            interface: Control surface interface

        Returns:
            bool: True if drawing succeeded, False otherwise
        """
        if not self.can_draw_on_interface():
            return False

        try:
            # Get current MIDI value for the animation state
            current_midi_value = self.midi_value

            # Apply the color to the element if provided
            if element and hasattr(element, 'set_light'):
                element.set_light(current_midi_value)
            elif element and hasattr(element, 'send_value'):
                element.send_value(current_midi_value)

            # Update animation step for next frame
            self._update_animation_step()

            return True

        except Exception:
            return False

    def convert_to_midi_value(self):
        """
        Convert the current color state to a MIDI value.

        Returns:
            int: MIDI value (0-127) representing the color
        """
        if self._base_color is None:
            return 0

        # If base color already has a MIDI value, use it
        if hasattr(self._base_color, 'midi_value'):
            base_midi = self._base_color.midi_value
        else:
            # Convert RGB to MIDI value using Ableton's utility
            base_midi = to_midi_value(self._base_color)

        # Apply animation modulation
        if self._animation_steps > 1:
            # Calculate animation progress (0.0 to 1.0)
            progress = old_div(self._current_step, float(self._animation_steps - 1))

            # Simple brightness modulation for animation
            # Could be more sophisticated (color cycling, pulsing, etc.)
            brightness_factor = 0.5 + 0.5 * abs(2 * progress - 1)

            # Modulate the base MIDI value
            animated_midi = int(base_midi * brightness_factor)
            return max(0, min(127, animated_midi))

        return base_midi

    def _update_animation_step(self):
        """
        Update the current animation step.
        """
        self._current_step = (self._current_step + 1) % self._animation_steps
        # Clear cache since step changed
        self._midi_value_cache = None

    def reset_animation(self):
        """
        Reset animation to the beginning.
        """
        self._current_step = 0
        self._midi_value_cache = None

    def set_color(self, color):
        """
        Set a new base color.

        Args:
            color: New color (Color object or RGB tuple)
        """
        self._base_color = color
        self._midi_value_cache = None

        # Update RGB representation
        if hasattr(color, 'rgb'):
            self._rgb_color = self.RgbColor(*color.rgb)
        elif isinstance(color, (tuple, list)) and len(color) >= 3:
            self._rgb_color = self.RgbColor(*color[:3])

    def __repr__(self):
        return f"AnimatedColor(midi_value={self.midi_value}, step={self._current_step})"