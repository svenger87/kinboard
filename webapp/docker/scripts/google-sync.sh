#!/bin/sh
# Google Calendar sync script for cron
wget -q -O - --header "Authorization: Bearer ${CRON_SECRET}" --post-data "" http://webapp:3000/api/cron/google-sync || echo "Sync failed: $?"
