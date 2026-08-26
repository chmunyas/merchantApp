-- Correct order refund balances where direct-sale principal is split into
-- revenue and tax adjustments. Invoice refunds continue to use the A/R component.

CREATE OR REPLACE FUNCTION order_paid_minor(
  p_venue_id TEXT,
  p_order_id UUID
) RETURNS BIGINT
LANGUAGE sql
STABLE
AS $function$
  SELECT GREATEST(
    0,
    COALESCE(
      sum(
        CASE
          WHEN payment.kind = 'refund' THEN -COALESCE(
            (
              SELECT sum(adjustment.amount)
              FROM financial_adjustments adjustment
              WHERE adjustment.refund_id = payment.id
                AND adjustment.component IN ('principal', 'tax', 'ar')
            ),
            0
          )
          ELSE payment.amount - COALESCE(payment.tip_amount, 0)
        END
      ),
      0
    )
  )::BIGINT
  FROM payments payment
  WHERE payment.venue_id = p_venue_id
    AND payment.status IN (
      'succeeded',
      'paid',
      'captured',
      'partially_refunded',
      'refunded'
    )
    AND (
      payment.metadata->>'order_id' = p_order_id::TEXT
      OR (
        payment.kind = 'refund'
        AND EXISTS (
          SELECT 1
          FROM payments original
          WHERE original.id = payment.metadata->>'refund_of'
            AND original.venue_id = p_venue_id
            AND original.metadata->>'order_id' = p_order_id::TEXT
        )
      )
    );
$function$;