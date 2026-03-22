# OpenAI App Store — Reviewer Test Cases

These test scenarios demonstrate SignupAssist's core functionality for the OpenAI review team.

---

## Test Case 1: Basic Activity Search

**Prompt**: "Show me robotics classes for kids in Denver"

**Expected**:
- Triggers `signupassist.start`
- Extracts intent: category=lessons, location=Denver
- Returns program listings with names, dates, prices
- Displays as cards with registration buttons

---

## Test Case 2: Registration Flow

**Prompt**: "Sign my daughter up for art camp"

**Expected**:
- Triggers `signupassist.start` or `signupassist.chat`
- Asks clarifying questions (age, location, specific provider)
- Once provider identified, shows available programs
- Guides through form-fill and payment

---

## Test Case 3: Provider-Specific Search

**Prompt**: "What programs does AIM Design have for a 9 year old?"

**Expected**:
- Recognizes "AIM Design" as a provider
- Extracts child age: 9
- Returns age-appropriate programs from AIM Design
- Shows program details (dates, times, prices)

---

## Test Case 4: Multi-Turn Conversation

**Turn 1**: "I need to sign up for ski lessons"
**Turn 2**: "My kid is 7"
**Turn 3**: "We're in Vail"

**Expected**:
- Each turn triggers `signupassist.chat`
- Progressively narrows search (activity → age → location)
- Final response shows matching ski lesson programs in Vail

---

## Test Case 5: New User Experience

**Prompt**: "I'm new here, I want to register my kids for swimming"

**Expected**:
- Detects "new user" signal
- Provides extra-helpful, reassuring tone
- Explains the process step by step
- Guides to program selection

---

## Test Case 6: Error Handling — No Results

**Prompt**: "Find underwater basket weaving classes in Antarctica"

**Expected**:
- Gracefully handles no-results scenario
- Returns friendly message suggesting broadening search
- Does NOT crash or return raw error

---

## Test Case 7: Location Disambiguation

**Prompt**: "Swimming lessons for my 6 year old"

**Expected**:
- Recognizes missing location
- Asks "What city or area are you in?" naturally
- After user provides location, returns results

---

## Test Case 8: Cancel/Decline Flow

**Prompt**: "Actually, never mind. I don't want to sign up."

**Expected**:
- Gracefully handles cancellation
- Returns polite decline message
- Does NOT persist unwanted state
