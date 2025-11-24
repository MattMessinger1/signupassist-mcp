-- Emergency update: Replace old single-tier schema with new two-tier Responsible Delegate schema
-- This updates all aim-design programs in cached_provider_feed

UPDATE cached_provider_feed
SET signup_form = jsonb_build_object(
  'delegate_fields', jsonb_build_array(
    jsonb_build_object(
      'id', 'delegate_firstName',
      'label', 'Your First Name',
      'type', 'text',
      'required', true
    ),
    jsonb_build_object(
      'id', 'delegate_lastName',
      'label', 'Your Last Name',
      'type', 'text',
      'required', true
    ),
    jsonb_build_object(
      'id', 'delegate_email',
      'label', 'Your Email',
      'type', 'email',
      'required', true
    ),
    jsonb_build_object(
      'id', 'delegate_phone',
      'label', 'Your Phone',
      'type', 'tel',
      'required', false
    ),
    jsonb_build_object(
      'id', 'delegate_dob',
      'label', 'Your Date of Birth',
      'type', 'date',
      'required', true,
      'helpText', 'Required to verify you are 18+ and authorized to register participants'
    ),
    jsonb_build_object(
      'id', 'delegate_relationship',
      'label', 'Relationship to Participant(s)',
      'type', 'select',
      'required', true,
      'options', jsonb_build_array(
        jsonb_build_object('value', 'parent', 'label', 'Parent'),
        jsonb_build_object('value', 'guardian', 'label', 'Legal Guardian'),
        jsonb_build_object('value', 'grandparent', 'label', 'Grandparent'),
        jsonb_build_object('value', 'other', 'label', 'Other Authorized Adult')
      )
    )
  ),
  'participant_fields', jsonb_build_array(
    jsonb_build_object('id', 'firstName', 'label', 'First Name', 'type', 'text', 'required', true),
    jsonb_build_object('id', 'lastName', 'label', 'Last Name', 'type', 'text', 'required', true),
    jsonb_build_object('id', 'dob', 'label', 'Date of Birth', 'type', 'date', 'required', true),
    jsonb_build_object('id', 'grade', 'label', 'Grade Level', 'type', 'text', 'required', false),
    jsonb_build_object('id', 'allergies', 'label', 'Allergies/Medical Notes', 'type', 'textarea', 'required', false)
  ),
  'max_participants', 10,
  'requires_age_verification', true,
  'minimum_delegate_age', 18
)
WHERE org_ref = 'aim-design';