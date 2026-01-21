"""Tests for the Interval class and range operations."""

import pytest

from temporale.core.date import Date
from temporale.core.datetime import DateTime
from temporale.core.duration import Duration
from temporale.core.interval import Interval
from temporale.units.timezone import Timezone


class TestIntervalConstruction:
    """Tests for Interval construction and validation."""

    def test_bounded_interval_construction(self) -> None:
        """Test creating a bounded interval."""
        start = Date(2024, 1, 1)
        end = Date(2024, 1, 31)
        interval = Interval(start, end)

        assert interval.start == start
        assert interval.end == end
        assert interval.is_bounded
        assert not interval.is_empty

    def test_interval_requires_start_before_end(self) -> None:
        """Test that interval raises ValueError if end <= start."""
        start = Date(2024, 1, 31)
        end = Date(2024, 1, 1)

        with pytest.raises(ValueError, match="end must be greater than start"):
            Interval(start, end)

    def test_interval_requires_different_start_and_end(self) -> None:
        """Test that interval raises ValueError if start == end."""
        date = Date(2024, 1, 15)

        with pytest.raises(ValueError, match="end must be greater than start"):
            Interval(date, date)

    def test_interval_with_datetime(self) -> None:
        """Test creating interval with DateTime."""
        start = DateTime(2024, 1, 15, 9, 0, 0)
        end = DateTime(2024, 1, 15, 17, 0, 0)
        interval = Interval(start, end)

        assert interval.start == start
        assert interval.end == end
        assert interval.is_bounded


class TestIntervalFactoryMethods:
    """Tests for Interval factory methods."""

    def test_since_creates_unbounded_end(self) -> None:
        """Test Interval.since() creates open-ended interval."""
        start = Date(2024, 1, 1)
        interval = Interval.since(start)

        assert interval.start == start
        assert interval.end is None
        assert not interval.is_bounded
        assert not interval.is_empty

    def test_until_creates_unbounded_start(self) -> None:
        """Test Interval.until() creates open-start interval."""
        end = Date(2024, 12, 31)
        interval = Interval.until(end)

        assert interval.start is None
        assert interval.end == end
        assert not interval.is_bounded
        assert not interval.is_empty

    def test_empty_creates_empty_interval(self) -> None:
        """Test Interval.empty() creates an empty interval."""
        interval = Interval.empty()

        assert interval.start is None
        assert interval.end is None
        assert interval.is_bounded  # Empty is considered bounded
        assert interval.is_empty


class TestIntervalProperties:
    """Tests for Interval property accessors."""

    def test_duration_of_bounded_interval(self) -> None:
        """Test duration() returns Duration for bounded interval."""
        start = Date(2024, 1, 1)
        end = Date(2024, 1, 31)
        interval = Interval(start, end)

        duration = interval.duration()
        assert duration is not None
        assert duration.days == 30  # Jan 1 to Jan 31 is 30 days

    def test_duration_of_datetime_interval(self) -> None:
        """Test duration() with DateTime interval."""
        start = DateTime(2024, 1, 15, 9, 0, 0)
        end = DateTime(2024, 1, 15, 17, 0, 0)
        interval = Interval(start, end)

        duration = interval.duration()
        assert duration is not None
        assert duration.seconds == 8 * 3600  # 8 hours

    def test_duration_of_unbounded_interval_is_none(self) -> None:
        """Test duration() returns None for unbounded interval."""
        interval = Interval.since(Date(2024, 1, 1))
        assert interval.duration() is None

        interval = Interval.until(Date(2024, 12, 31))
        assert interval.duration() is None

    def test_duration_of_empty_interval_is_none(self) -> None:
        """Test duration() returns None for empty interval."""
        interval = Interval.empty()
        assert interval.duration() is None


class TestIntervalContainsPoint:
    """Tests for point containment."""

    def test_contains_point_in_middle(self) -> None:
        """Test that point in the middle is contained."""
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        assert interval.contains(Date(2024, 1, 15))
        assert Date(2024, 1, 15) in interval

    def test_contains_point_at_start(self) -> None:
        """Test that start point is contained (inclusive)."""
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        assert interval.contains(Date(2024, 1, 1))
        assert Date(2024, 1, 1) in interval

    def test_does_not_contain_point_at_end(self) -> None:
        """Test that end point is not contained (exclusive)."""
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        assert not interval.contains(Date(2024, 1, 31))
        assert Date(2024, 1, 31) not in interval

    def test_does_not_contain_point_before_start(self) -> None:
        """Test that point before start is not contained."""
        interval = Interval(Date(2024, 1, 10), Date(2024, 1, 20))
        assert not interval.contains(Date(2024, 1, 5))

    def test_does_not_contain_point_after_end(self) -> None:
        """Test that point after end is not contained."""
        interval = Interval(Date(2024, 1, 10), Date(2024, 1, 20))
        assert not interval.contains(Date(2024, 1, 25))

    def test_unbounded_since_contains_future_points(self) -> None:
        """Test Interval.since contains all future points."""
        interval = Interval.since(Date(2024, 1, 1))
        assert interval.contains(Date(2024, 6, 15))
        assert interval.contains(Date(2030, 12, 31))
        assert interval.contains(Date(2024, 1, 1))  # Start is inclusive
        assert not interval.contains(Date(2023, 12, 31))

    def test_unbounded_until_contains_past_points(self) -> None:
        """Test Interval.until contains all past points."""
        interval = Interval.until(Date(2024, 12, 31))
        assert interval.contains(Date(2024, 6, 15))
        assert interval.contains(Date(2000, 1, 1))
        assert not interval.contains(Date(2024, 12, 31))  # End is exclusive

    def test_empty_contains_nothing(self) -> None:
        """Test empty interval contains no points."""
        interval = Interval.empty()
        # Note: We can't directly test contains with a Date because
        # empty intervals have no type parameter bound, but we can
        # test the internal method
        assert not interval._contains_point(Date(2024, 1, 15))  # type: ignore


class TestIntervalContainsInterval:
    """Tests for interval containment."""

    def test_contains_subinterval(self) -> None:
        """Test that an interval contains its subinterval."""
        outer = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        inner = Interval(Date(2024, 1, 5), Date(2024, 1, 10))
        assert outer.contains(inner)

    def test_does_not_contain_larger_interval(self) -> None:
        """Test that an interval doesn't contain a larger one."""
        inner = Interval(Date(2024, 1, 5), Date(2024, 1, 10))
        outer = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        assert not inner.contains(outer)

    def test_contains_identical_interval(self) -> None:
        """Test that an interval contains an identical interval."""
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        same = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        assert interval.contains(same)

    def test_does_not_contain_overlapping_interval(self) -> None:
        """Test that overlapping but not contained returns False."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 20))
        i2 = Interval(Date(2024, 1, 10), Date(2024, 1, 30))
        assert not i1.contains(i2)
        assert not i2.contains(i1)

    def test_contains_empty_interval(self) -> None:
        """Test that any non-empty interval contains the empty interval."""
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        assert interval.contains(Interval.empty())

    def test_empty_contains_nothing(self) -> None:
        """Test that empty interval contains nothing, not even empty."""
        empty = Interval.empty()
        assert not empty.contains(Interval.empty())
        # Can't test with bounded intervals due to type issues


class TestIntervalOverlap:
    """Tests for overlap detection."""

    def test_overlapping_intervals(self) -> None:
        """Test two overlapping intervals."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 20))
        i2 = Interval(Date(2024, 1, 15), Date(2024, 1, 31))
        assert i1.overlaps(i2)
        assert i2.overlaps(i1)

    def test_adjacent_intervals_do_not_overlap(self) -> None:
        """Test that adjacent intervals don't overlap."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 15))
        i2 = Interval(Date(2024, 1, 15), Date(2024, 1, 31))
        assert not i1.overlaps(i2)
        assert not i2.overlaps(i1)

    def test_disjoint_intervals(self) -> None:
        """Test non-overlapping intervals with gap."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 10))
        i2 = Interval(Date(2024, 1, 20), Date(2024, 1, 31))
        assert not i1.overlaps(i2)
        assert not i2.overlaps(i1)

    def test_contained_interval_overlaps(self) -> None:
        """Test that a contained interval overlaps with container."""
        outer = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        inner = Interval(Date(2024, 1, 10), Date(2024, 1, 20))
        assert outer.overlaps(inner)
        assert inner.overlaps(outer)

    def test_empty_does_not_overlap(self) -> None:
        """Test that empty intervals don't overlap with anything."""
        empty = Interval.empty()
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        assert not empty.overlaps(interval)  # type: ignore
        assert not interval.overlaps(empty)  # type: ignore

    def test_unbounded_intervals_overlap(self) -> None:
        """Test overlap with unbounded intervals."""
        since = Interval.since(Date(2024, 1, 1))
        until = Interval.until(Date(2024, 12, 31))
        assert since.overlaps(until)

        # Since starting after until ends
        since_late = Interval.since(Date(2025, 1, 1))
        assert not since_late.overlaps(until)


class TestIntervalGap:
    """Tests for gap calculation."""

    def test_gap_between_disjoint_intervals(self) -> None:
        """Test gap between non-overlapping intervals."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 10))
        i2 = Interval(Date(2024, 1, 15), Date(2024, 1, 25))

        gap = i1.gap(i2)
        assert gap is not None
        assert gap.days == 5  # Jan 10 to Jan 15

    def test_gap_is_symmetric(self) -> None:
        """Test that gap is the same in both directions."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 10))
        i2 = Interval(Date(2024, 1, 15), Date(2024, 1, 25))

        assert i1.gap(i2) == i2.gap(i1)

    def test_gap_between_adjacent_intervals_is_zero(self) -> None:
        """Test that adjacent intervals have zero gap."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 10))
        i2 = Interval(Date(2024, 1, 10), Date(2024, 1, 20))

        gap = i1.gap(i2)
        assert gap is not None
        assert gap.is_zero

    def test_overlapping_intervals_have_no_gap(self) -> None:
        """Test that overlapping intervals return None for gap."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 20))
        i2 = Interval(Date(2024, 1, 15), Date(2024, 1, 31))

        assert i1.gap(i2) is None

    def test_empty_interval_gap_is_none(self) -> None:
        """Test that empty intervals have no meaningful gap."""
        empty = Interval.empty()
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        assert empty.gap(interval) is None  # type: ignore


class TestIntervalUnion:
    """Tests for union operation."""

    def test_union_of_overlapping_intervals(self) -> None:
        """Test union of overlapping intervals."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 20))
        i2 = Interval(Date(2024, 1, 15), Date(2024, 1, 31))

        result = i1.union(i2)
        assert result is not None
        assert result.start == Date(2024, 1, 1)
        assert result.end == Date(2024, 1, 31)

    def test_union_of_adjacent_intervals(self) -> None:
        """Test union of adjacent intervals."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 15))
        i2 = Interval(Date(2024, 1, 15), Date(2024, 1, 31))

        result = i1.union(i2)
        assert result is not None
        assert result.start == Date(2024, 1, 1)
        assert result.end == Date(2024, 1, 31)

    def test_union_of_disjoint_intervals_is_none(self) -> None:
        """Test union of disjoint intervals returns None."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 10))
        i2 = Interval(Date(2024, 1, 20), Date(2024, 1, 31))

        assert i1.union(i2) is None

    def test_union_of_contained_intervals(self) -> None:
        """Test union when one contains the other."""
        outer = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        inner = Interval(Date(2024, 1, 10), Date(2024, 1, 20))

        result = outer.union(inner)
        assert result is not None
        assert result == outer

    def test_union_with_empty(self) -> None:
        """Test union with empty interval."""
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        empty = Interval.empty()

        result = interval.union(empty)  # type: ignore
        assert result == interval

        result = empty.union(interval)  # type: ignore
        assert result == interval

    def test_union_of_unbounded_intervals(self) -> None:
        """Test union with unbounded intervals."""
        since = Interval.since(Date(2024, 6, 1))
        bounded = Interval(Date(2024, 1, 1), Date(2024, 7, 1))

        result = since.union(bounded)
        assert result is not None
        assert result.start == Date(2024, 1, 1)
        assert result.end is None  # Unbounded


class TestIntervalIntersection:
    """Tests for intersection operation."""

    def test_intersection_of_overlapping_intervals(self) -> None:
        """Test intersection of overlapping intervals."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 20))
        i2 = Interval(Date(2024, 1, 15), Date(2024, 1, 31))

        result = i1.intersection(i2)
        assert result is not None
        assert result.start == Date(2024, 1, 15)
        assert result.end == Date(2024, 1, 20)

    def test_intersection_of_disjoint_intervals_is_none(self) -> None:
        """Test intersection of disjoint intervals returns None."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 10))
        i2 = Interval(Date(2024, 1, 20), Date(2024, 1, 31))

        assert i1.intersection(i2) is None

    def test_intersection_of_adjacent_intervals_is_none(self) -> None:
        """Test intersection of adjacent intervals returns None."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 15))
        i2 = Interval(Date(2024, 1, 15), Date(2024, 1, 31))

        assert i1.intersection(i2) is None

    def test_intersection_of_contained_intervals(self) -> None:
        """Test intersection when one contains the other."""
        outer = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        inner = Interval(Date(2024, 1, 10), Date(2024, 1, 20))

        result = outer.intersection(inner)
        assert result is not None
        assert result == inner

    def test_intersection_with_empty(self) -> None:
        """Test intersection with empty interval."""
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        empty = Interval.empty()

        assert interval.intersection(empty) is None  # type: ignore
        assert empty.intersection(interval) is None  # type: ignore

    def test_intersection_with_unbounded(self) -> None:
        """Test intersection with unbounded interval."""
        since = Interval.since(Date(2024, 6, 1))
        bounded = Interval(Date(2024, 1, 1), Date(2024, 12, 31))

        result = since.intersection(bounded)
        assert result is not None
        assert result.start == Date(2024, 6, 1)
        assert result.end == Date(2024, 12, 31)


class TestIntervalEmptyHandling:
    """Tests for empty interval behavior."""

    def test_empty_is_empty(self) -> None:
        """Test is_empty property."""
        assert Interval.empty().is_empty

    def test_bounded_is_not_empty(self) -> None:
        """Test bounded interval is not empty."""
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 2))
        assert not interval.is_empty

    def test_unbounded_is_not_empty(self) -> None:
        """Test unbounded intervals are not empty."""
        assert not Interval.since(Date(2024, 1, 1)).is_empty
        assert not Interval.until(Date(2024, 1, 1)).is_empty

    def test_empty_bool_is_false(self) -> None:
        """Test empty interval is falsy."""
        assert not Interval.empty()

    def test_non_empty_bool_is_true(self) -> None:
        """Test non-empty interval is truthy."""
        assert Interval(Date(2024, 1, 1), Date(2024, 1, 2))


class TestIntervalWithDateVsDateTime:
    """Tests for Interval with Date vs DateTime."""

    def test_date_interval_duration(self) -> None:
        """Test Date interval duration is in whole days."""
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 8))
        duration = interval.duration()
        assert duration is not None
        assert duration.days == 7
        assert duration.seconds == 0

    def test_datetime_interval_duration(self) -> None:
        """Test DateTime interval duration has time precision."""
        start = DateTime(2024, 1, 1, 0, 0, 0)
        end = DateTime(2024, 1, 1, 12, 30, 0)
        interval = Interval(start, end)

        duration = interval.duration()
        assert duration is not None
        assert duration.days == 0
        assert duration.seconds == 12 * 3600 + 30 * 60

    def test_datetime_interval_with_timezone(self) -> None:
        """Test DateTime interval with timezone."""
        tz = Timezone.utc()
        start = DateTime(2024, 1, 1, 0, 0, 0, timezone=tz)
        end = DateTime(2024, 1, 2, 0, 0, 0, timezone=tz)
        interval = Interval(start, end)

        assert interval.is_bounded
        duration = interval.duration()
        assert duration is not None
        assert duration.days == 1


class TestIntervalEquality:
    """Tests for Interval equality and hashing."""

    def test_equal_intervals(self) -> None:
        """Test that equal intervals compare equal."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        i2 = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        assert i1 == i2

    def test_unequal_intervals(self) -> None:
        """Test that unequal intervals compare unequal."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        i2 = Interval(Date(2024, 1, 1), Date(2024, 1, 30))
        assert i1 != i2

    def test_empty_intervals_equal(self) -> None:
        """Test that empty intervals are equal."""
        assert Interval.empty() == Interval.empty()

    def test_hash_equal_intervals(self) -> None:
        """Test that equal intervals have equal hashes."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        i2 = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        assert hash(i1) == hash(i2)

    def test_intervals_usable_in_set(self) -> None:
        """Test that intervals can be used in sets."""
        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        i2 = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        i3 = Interval(Date(2024, 2, 1), Date(2024, 2, 28))

        s = {i1, i2, i3}
        assert len(s) == 2  # i1 and i2 are duplicates


class TestIntervalStringRepresentation:
    """Tests for Interval string representation."""

    def test_repr_bounded(self) -> None:
        """Test repr of bounded interval."""
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        assert repr(interval) == "Interval(Date(2024, 1, 1), Date(2024, 1, 31))"

    def test_repr_since(self) -> None:
        """Test repr of since interval."""
        interval = Interval.since(Date(2024, 1, 1))
        assert repr(interval) == "Interval.since(Date(2024, 1, 1))"

    def test_repr_until(self) -> None:
        """Test repr of until interval."""
        interval = Interval.until(Date(2024, 12, 31))
        assert repr(interval) == "Interval.until(Date(2024, 12, 31))"

    def test_repr_empty(self) -> None:
        """Test repr of empty interval."""
        assert repr(Interval.empty()) == "Interval.empty()"

    def test_str_bounded(self) -> None:
        """Test str of bounded interval uses math notation."""
        interval = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        assert str(interval) == "[2024-01-01, 2024-01-31)"

    def test_str_since(self) -> None:
        """Test str of since interval."""
        interval = Interval.since(Date(2024, 1, 1))
        assert str(interval) == "[2024-01-01, ∞)"

    def test_str_until(self) -> None:
        """Test str of until interval."""
        interval = Interval.until(Date(2024, 12, 31))
        assert str(interval) == "(-∞, 2024-12-31)"

    def test_str_empty(self) -> None:
        """Test str of empty interval."""
        assert str(Interval.empty()) == "∅"


class TestRangeOps:
    """Tests for range_ops module functions."""

    def test_merge_overlapping_intervals(self) -> None:
        """Test merging overlapping intervals."""
        from temporale.arithmetic.range_ops import merge_intervals

        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 15))
        i2 = Interval(Date(2024, 1, 10), Date(2024, 1, 20))
        i3 = Interval(Date(2024, 2, 1), Date(2024, 2, 10))

        result = merge_intervals([i1, i2, i3])
        assert len(result) == 2
        assert result[0] == Interval(Date(2024, 1, 1), Date(2024, 1, 20))
        assert result[1] == Interval(Date(2024, 2, 1), Date(2024, 2, 10))

    def test_span_intervals(self) -> None:
        """Test spanning multiple intervals."""
        from temporale.arithmetic.range_ops import span_intervals

        i1 = Interval(Date(2024, 1, 10), Date(2024, 1, 15))
        i2 = Interval(Date(2024, 1, 1), Date(2024, 1, 5))
        i3 = Interval(Date(2024, 1, 20), Date(2024, 1, 25))

        result = span_intervals([i1, i2, i3])
        assert result is not None
        assert result.start == Date(2024, 1, 1)
        assert result.end == Date(2024, 1, 25)

    def test_find_gaps(self) -> None:
        """Test finding gaps between intervals."""
        from temporale.arithmetic.range_ops import find_gaps

        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 10))
        i2 = Interval(Date(2024, 1, 20), Date(2024, 1, 30))

        gaps = find_gaps([i1, i2])
        assert len(gaps) == 1
        assert gaps[0] == Interval(Date(2024, 1, 10), Date(2024, 1, 20))

    def test_total_duration(self) -> None:
        """Test total duration of multiple intervals."""
        from temporale.arithmetic.range_ops import total_duration

        i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 10))  # 9 days
        i2 = Interval(Date(2024, 1, 5), Date(2024, 1, 15))  # Overlaps

        result = total_duration([i1, i2])
        assert result is not None
        # Merged: Jan 1 to Jan 15 = 14 days
        assert result.days == 14
